# 公共代理

本仓库不使用上游的公共代理，也不把玩家改写到上游域名。

默认地址是已部署的发行方代理 `https://zhima-public-proxy.sullyos-sxy10.workers.dev`，定义在 `utils/proxyWorker.ts` 的 `PUBLISHER_PUBLIC_PROXY_URL`，部署配置是 `worker/wrangler.public-proxy.toml`。构建变量 `VITE_PUBLIC_PROXY_URL` 只接受另一份 https 地址。玩家在设置里保存的地址优先。

读到上游公共代理主机名时，请求不会发出，也不会改写成另一个上游域名。主动消息和推送不走这份代理里的私人服务。
