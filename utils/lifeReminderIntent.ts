/** Only explicit requests about the user's own reminders enter the local reminder tool. */
export function isLifeReminderIntent(text: string): boolean {
  const input = text.trim();
  if (!input || /(?:不是|并非|没让|不想让|不要你|不用你).{0,12}(?:设置|创建|安排|修改|管理).{0,6}提醒/.test(input)) return false;
  if (!/提醒|待提醒|待办|闹钟|催我|叫我|喊我|别忘/.test(input)) return false;
  if (/(?:你|他|她|角色).{0,8}(?:的|自己).{0,6}(?:提醒|日程|待办)/.test(input) && !/(?:我|我的|帮我|给我)/.test(input)) return false;
  return /(?:我的|我有|我还有).{0,8}(?:提醒|待办).{0,6}(?:有哪些|有几|清单|列表|吗|？|\?)|(?:提醒|待办).{0,8}(?:有哪些|清单|列表|还有哪些)|(?:提醒我|叫我|喊我|催我)|帮我.{0,8}(?:提醒|设|查|看|取消|改)|给我.{0,8}(?:设|查|看|列).{0,6}(?:提醒|待办)|(?:设|建|加|安排|创建|添加|改期|改成|改到|推迟|提前|取消|删除|暂停|恢复|停掉|列出|查询|查看|完成).{0,14}(?:提醒|待办|闹钟)|(?:提醒|待办|闹钟).{0,12}(?:改期|改成|改到|推迟|提前|取消|删除|暂停|恢复|停掉|列出|查询|查看|完成)|(?:不用|别|不要|无需|不必)再?(?:提醒|催我)/.test(input);
}

export function lifeReminderToolNotice(intent: boolean, results: string[]): string | null {
  if (!intent) return null;
  if (!results.length) return '生活提醒未执行：本轮没有调用管理工具，任何排程或改动都尚未核实。';
  const failures = results.filter(result => /失败|未完成|无法保证|未确认|没有唯一|请确认|请明确|请说/.test(result));
  return failures.length ? `生活提醒工具回执：${failures.join('；')}` : null;
}

export function hasUnverifiedReminderClaim(text: string): boolean {
  return /(?:已经|已|帮你|给你).{0,12}(?:设好|设置|安排|排好|保存|取消|改好|推迟|暂停|完成)|(?:我会|到时|一定会).{0,12}(?:提醒|通知|叫|喊)你/.test(text);
}

export function isLegacyLifeReminderReceipt(text: string): boolean {
  return text === '我还没能核实或更改生活提醒。请稍后再试；目前不能保证自动送达。'
    || /^(?:生活提醒操作失败：|操作未完成：)/.test(text);
}
