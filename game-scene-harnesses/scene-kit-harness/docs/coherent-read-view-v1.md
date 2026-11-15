# Coherent一次校验的只读快照

0.74.0处理真实多次修订后高层检查反复完整解码同一PNG的问题。此前inspect按历史
batch逐个getter，computeSnapshot再按plan逐个getter，每次getter都完整读取、hash和
重放整个journal；历史批次和来源数量增加会把一次检查放大成许多次完整校验。

readCoherentWorkflowView(root,{includeCurrentInputs:false})在一个新的锁定事务中读取/
hash全部blob、完整重放journal，然后返回旧inspection形状、detached plan/batch元数据
与本次inputs Map。includeCurrentInputs=true时只为当前参考或同参考最新Coherent批次
的非零调用来源读取输入；沿用readGenerationInput的全部索引/长度/字节校验，按SHA
去重当前Buffer副本。旧style/ref历史仍可检索元数据，但不因额外读取旧输入阻挡新包。

projectAt、inspect、computeSnapshot及compute-review导出共享私有context，不在循环中
再次调用每项getter。每个公开读操作仍fresh取锁、验证全部原字节并重放一次；没有
workflow、计划、PNG解码、QA或失败结果缓存。下一次读取会看见状态变化或字节篡改。

这份view不是授权令牌或写context，不传给reserve/receive/authorize等写API。写入仍
重新获取锁、重放当前记录并执行原门禁。旧公开inspectWorkflow/getter字段保持，
计划、请求、输入次序、摘要、snapshot和完整compute-review包不改变。Studio HTTP
边界也不增加端点。

测试覆盖v1及含5个历史batch、max0准备与guided来源的v2，与旧getter算法逐字节比较
inspection、snapshot和整个准确包；实际锁打开计数验证每次公开读只有1个事务；
当前输入选择、篡改/状态变化拒绝、返回view修改隔离均验证。新4＋coherent pipeline6＋
source-guide integration4共14项通过，55固定文件重放一致，全部为合成替身，零生图。
