# v0.2：TimeBack Shield + 快捷指令记录

这一版把职责拆开：

- **TimeBack** 负责系统 Shield，`Sleepy Dog Lock` 在设定时间直接封住娱乐 App。
- **服务器** 负责晚安状态、偷开次数、Bark 文案和永久事件记录。
- **快捷指令** 只发送三个简单事件，不再在手机本地保存 JSON，也不再自己计算次数。

> 重要：快捷指令不会把 App 踢回主屏幕。TimeBack 已经提供 Shield；再跳回主屏幕反而会让拦截页一闪而过。

## 先决条件

1. TimeBack 中已经保存并启用 `Sleepy Dog Lock`。
2. `netlify/` 已部署，获得 `https://<site>.netlify.app/api/sleep-guard-event`。
3. Netlify 已配置 `SLEEP_GUARD_SHORTCUT_TOKEN` 和 `BARK_DEVICE_KEY`。

手机中所有请求都使用：

- 方法：`POST`
- Header `Authorization`：`Bearer <SLEEP_GUARD_SHORTCUT_TOKEN>`
- Header `Content-Type`：`application/json`

## A. “爸爸晚安”快捷指令

新建快捷指令 `爸爸晚安`，只做两件事：

1. 用“获取 URL 内容”向事件 URL 发送：

```json
{"event":"sleep_guard_started","source":"ios_shortcuts"}
```

2. 锁定屏幕。

服务器会开启睡眠会话，并把次数清零；未指定结束时间时，会在上海时间下一次上午 8:00 自动过期。重复运行不会清掉当晚已经产生的次数。

## B. “抓到小狗”快捷指令

新建快捷指令 `抓到小狗`，向同一 URL 发送：

```json
{"event":"blocked_app_opened","app_name":"小红书","source":"ios_automation"}
```

这条自动化同时负责深夜兜底：上海时间凌晨 0:00 至上午 8:00，即使没有先说晚安，第一次打开受限 App 也会由服务器自动开启睡眠守卫。服务器会返回非 `inactive` 阶段，现有条件判断会照常锁屏，无需增加新的手机动作。

不需要本地文件、加法或自行计数。读取响应中的 `stage`；当它不是 `inactive` 时执行“锁定屏幕”。服务器会自动判断：

- 第一次：`被爸爸抓到了`；
- 第二次：`第二次，继续锁死`；
- 第三次及以后：`拒不睡觉，已记录`。

如果还没说晚安或会话已经结束，事件仍会留下记录，但不会发 Bark。

## C. App 打开自动化

快捷指令 → 自动化 → 新建个人自动化：

1. 触发条件选 **App** → **打开时**。
2. 先只勾选小红书测试。
3. 动作只放 **运行快捷指令：抓到小狗**。
4. 选择 **立即运行**；关闭运行通知（若系统提供）。

测试通过后再加入抖音、微博、B 站和游戏。不要加入电话、信息、地图、支付或医疗类 App。

如果希望 Bark 显示不同 App 名称，可以为每个 App 复制一份“抓到小狗”快捷指令并修改 `app_name`；不改也不影响计数和拦截。

## D. “小狗起床”快捷指令

新建快捷指令 `小狗起床`，发送：

```json
{"event":"sleep_guard_ended","source":"ios_shortcuts"}
```

再给它建立每天 09:30 的时间自动化并选择 **立即运行**。这会结束服务器的会话；TimeBack 的 Shield 仍按 `Sleepy Dog Lock` 自己的 09:30 结束。

## 验收顺序

1. 临时把 TimeBack 的测试时间设到当前时刻附近，确认小红书显示 Shield。
2. 运行 `爸爸晚安`，应收到守卫开启 Bark。
3. 连续打开小红书三次，应依次收到三档不同文案，且每次都仍在 Shield 外。
4. 运行 `小狗起床` 后再开小红书，不应再收到“偷开” Bark。

## 真实边界

- 当前 Shield 的开始与结束由 TimeBack 的固定日程决定；快捷指令不能凭空控制第三方 App。请先在自己的 iPhone 上检查 TimeBack 是否提供“运行快捷指令”动作。如果有，晚安快捷指令可以同时立即启用规则；如果没有，提前说晚安时需要在 TimeBack 手动开启，固定日程负责兜底。
- 使用者仍能关闭自动化、撤销屏幕使用时间权限或删除 TimeBack。设置 TimeBack Passcode/Guardian 后会显著增加绕开的成本，但不存在手机所有者绝对无法撤销的自控工具。
- Bark 负责通知和留下证据；真正挡住 App 的是 TimeBack Shield。
