"""Local podcast adapter. Optional account client stays outside the repository."""
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import BaseHandler, build_opener, install_opener, urlopen, Request

sys.dont_write_bytecode = True
tool_dir = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(tool_dir))
try:
    import podcast_tool as tool
except ImportError:
    tool = None

class PodcastError(Exception):
    pass

ToolError = tool.ToolError if tool else PodcastError


class OnlyXiaoyuzhou(BaseHandler):
    def https_request(self, request):
        url = urlsplit(request.full_url)
        host = url.hostname or ''
        if not (host in {'www.xiaoyuzhoufm.com', 'api.xiaoyuzhoufm.com',
                         'web-api.xiaoyuzhoufm.com'} or host.endswith('.xyzcdn.net')):
            raise ToolError('小宇宙返回了未支持的资源地址。')
        if url.username or url.password or url.port not in (None, 443):
            raise ToolError('小宇宙资源地址无效。')
        return request

    def http_request(self, request):
        raise ToolError('小宇宙资源必须使用 HTTPS。')


install_opener(build_opener(OnlyXiaoyuzhou()))
client = None
qr_deadline = 0
qr_id = ''


def episode_url(eid):
    if not isinstance(eid, str) or not re.fullmatch('[a-f0-9]{24}', eid):
        raise ToolError('单集链接无效。')
    return 'https://www.xiaoyuzhoufm.com/episode/' + eid


def get_client():
    if not tool:
        raise ToolError('未安装可选登录客户端。仍可读取公开节目、导入本机音频和时间戳文稿。')
    result = tool.Client()
    result.auth_opener.add_handler(OnlyXiaoyuzhou())
    return result


def image_url(record):
    image = record.get('image') or record.get('cover') or {}
    if isinstance(image, dict):
        return image.get('picUrl') or image.get('middlePicUrl') or image.get('thumbnailUrl') or ''
    return image if isinstance(image, str) else ''


def public_episode(eid):
    if tool:
        return tool.get_episode(episode_url(eid))
    request = Request(episode_url(eid), headers={'User-Agent': 'Mozilla/5.0'})
    with urlopen(request, timeout=30) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ToolError('节目页面过大，请稍后重试。')
    match = re.search(r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', raw.decode('utf-8'), re.S)
    if not match:
        raise ToolError('节目页面格式已改变，暂时无法读取。')
    data = json.loads(match.group(1))
    def find(value):
        if isinstance(value, dict):
            if value.get('eid') == eid and isinstance(value.get('title'), str):
                return value
            for child in value.values():
                result = find(child)
                if result:
                    return result
        elif isinstance(value, list):
            for child in value:
                result = find(child)
                if result:
                    return result
        return None
    result = find(data)
    if not result:
        raise ToolError('节目页面未提供可识别的单集资料。')
    return result


def episode(eid):
    ep = public_episode(eid)
    podcast = ep.get('podcast') or {}
    try:
        audio = tool.audio_url(ep) if tool else ((ep.get('enclosure') or {}).get('url') or '')
        url = urlsplit(audio)
        if not (url.hostname or '').endswith('.xyzcdn.net') or url.username or url.password or url.port not in (None, 443):
            audio = ''
    except ToolError:
        audio = ''
    return {'eid': eid, 'title': ep['title'], 'podcast': podcast.get('title', ''),
            'description': ep.get('description') or '', 'cover': image_url(ep) or image_url(podcast),
            'durationMs': max(0, int((ep.get('duration') or 0) * 1000)),
            'audioUrl': audio, 'hasTranscript': bool(tool.media_id(ep)) if tool else False}


def start_login():
    global client, qr_id, qr_deadline
    import qrcode
    client = get_client()
    qr = client.create_qr()
    qr_id = qr['id']
    qr_deadline = time.monotonic() + 180
    matrix = qrcode.QRCode(border=4)
    matrix.add_data(qr['url'])
    matrix.make(fit=True)
    rows = matrix.get_matrix()
    size = len(rows)
    path = ''.join(f'M{x},{y}h1v1h-1z' for y, row in enumerate(rows) for x, on in enumerate(row) if on)
    return {'svg': f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="{path}"/></svg>'}


def dispatch(action, eid):
    global client, qr_id
    if action == 'status':
        return {'loggedIn': get_client().logged_in if tool else False, 'accountClient': bool(tool)}
    if action == 'episode':
        return episode(eid)
    if action == 'transcript':
        if not tool:
            raise ToolError('在线文稿需要可选登录客户端；可以导入已有时间戳 JSON。')
        ep = tool.get_episode(episode_url(eid))
        return get_client().transcript(ep)
    if action == 'loginStart':
        return start_login()
    if action == 'loginPoll':
        if not client or not qr_id or time.monotonic() >= qr_deadline:
            raise ToolError('二维码已过期，请重新扫码。')
        state = client.poll_qr(qr_id)
        if state == 'CONFIRMED':
            qr_id = ''
            client = None
        return {'state': state}
    if action == 'logout':
        get_client().logout()
        qr_id = ''
        client = None
        return {}
    raise ToolError('不支持的操作。')


for line in sys.stdin:
    request_id = None
    try:
        data = json.loads(line)
        request_id = data['id']
        result = dispatch(data.get('action'), data.get('eid'))
        reply = {'id': request_id, 'data': result}
    except ToolError as exc:
        reply = {'id': request_id, 'error': str(exc)}
    except Exception:
        reply = {'id': request_id, 'error': '小宇宙请求失败，请检查连接后重试。'}
    print(json.dumps(reply, ensure_ascii=False), flush=True)
