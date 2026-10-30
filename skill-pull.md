# 上游同步入口

本仓库的现行流程见 [公开二改的上游同步与手动发布](docs/upstream-sync-and-manual-deploy.md) 和 [当前交接](docs/handoff/CURRENT.md)。

先核对分支、远程提交和工作区差异，再按本轮授权合入。保护未提交和未跟踪文件；不为同步而自动 reset、clean、stash pop 或推送。

stash 命令报错时先查看副本内容、未跟踪文件和目标冲突，保留原副本继续恢复。不能先删除 stash 再判断它是否包含唯一文件；确认内容完整恢复并有可靠副本后，才在明确丢弃授权下清理。
