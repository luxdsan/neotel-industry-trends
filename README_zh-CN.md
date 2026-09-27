# Neotel Industry Trends — PCB/SMT 行业趋势 Agent（中文说明）

本仓库是 [`TencentEdgeOne/ai-trends-agent`](https://github.com/TencentEdgeOne/ai-trends-agent) 的 fork，
已改造为 **PCB / SMT / EMS 行业趋势 Agent**，运行在 EdgeOne Makers 上：每天 09:00（北京时间）采集
公开行业资讯 → 策展 → 中文事实摘要（≤80 字）→ 打分聚类（设备 / 材料 / 供应链 / 政策标准 / 展会 / 厂商动态）
→ 生成 Markdown 日报 + 结构化 JSON（`schema.json`），供 CN 服务器的结果同步器写入 WordPress。

- 部署与运维手册：[`docs/RUNBOOK.md`](docs/RUNBOOK.md)（环境变量名、从 Git 建项目、手动触发、读取接口、待办）
- 代码结构说明：[`docs/ARCHITECTURE-NOTES.md`](docs/ARCHITECTURE-NOTES.md)
- 信息源清单（增删源只改这里）：[`agents/trends/_source_list.ts`](agents/trends/_source_list.ts)
- 数据契约与样例：[`schema.json`](schema.json)、[`docs/sample-brief.json`](docs/sample-brief.json)

英文 README（接口表、环境变量、目录结构）见 [`README.md`](README.md)。

内容口径（代码强制，不只靠提示词）：摘要只写事实、不超过 80 字；不使用绝对化用语；其他厂商名称只作事实归属、
不做比较；「挚锦解读」仅在与 SMT 物料管理（料盘存储、点料、注册、MSD、配料）有真实关联时生成，否则为空。
