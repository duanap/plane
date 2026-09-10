# Plane · 炸飞机

一个 10×10 坐标推理对战小游戏。双方各部署 3 架固定形状飞机，轮流攻击坐标；命中机头即击落整架飞机，率先击落全部 3 架者获胜。

## 当前版本

V1 已包含两种可玩入口：

- **在线双人**：创建 6 位房间码，分享邀请链接，两台设备独立部署并实时对战。
- **本地双人**：同一设备 Hot-seat，对局阶段通过隐私交接屏避免看到对方布阵。

核心规则与能力：

- 10×10 棋盘；每人固定 3 架飞机。
- 每架飞机 10 格：1 个机头 + 9 个机身；翼展 5、身长 4、尾宽 3。
- 上 / 右 / 下 / 左四向旋转，禁止出界和重叠，允许相邻。
- MISS / HIT / DESTROYED 三类攻击结果。
- 击中机头立即击落并公开整架飞机。
- 重复攻击被拒绝且不消耗回合。
- 第三架飞机被击落后立即结束比赛，并公开双方完整战场。
- 在线版由服务端权威判定，客户端不会收到未击落的敌机布局。
- 在线房间支持 SSE 实时更新、断线自动重连、刷新后凭玩家 token 恢复身份。
- 双方都点击“再来一局”后，保留房间和身份并重新进入布阵。

## 技术结构

V1 保持零运行时依赖：

```text
Browser
  ├─ 本地双人：直接复用 TypeScript game engine
  └─ 在线双人：HTTP JSON commands + SSE state stream
                         ↓
                    RoomStore
                         ↓
                  Game Engine
```

在线传输使用 **HTTP JSON + Server-Sent Events (SSE)**。这是回合制游戏所需的实时推送模型，同时无需额外 WebSocket/Socket.IO 依赖。房间域与传输层分离，后续可以替换为 WebSocket 而无需改游戏规则。

## 本地运行

要求：

```text
Node.js 22+
TypeScript 5.8+
```

执行：

```bash
npm test
npm run build
npm start
```

默认地址：

```text
本地双人：http://localhost:4173/
在线双人：http://localhost:4173/online.html
健康检查：http://localhost:4173/health
```

也可以指定端口：

```bash
PORT=8080 npm start
```

## 在线房间 API

```text
POST /api/rooms
POST /api/rooms/:roomId/join
GET  /api/rooms/:roomId/state?token=...
POST /api/rooms/:roomId/fleet
POST /api/rooms/:roomId/ready
POST /api/rooms/:roomId/attack
POST /api/rooms/:roomId/rematch
GET  /api/rooms/:roomId/events?token=...
```

房间码使用 6 位易读字符，并排除 `0 / 1 / I / O` 等容易混淆的字符。邀请链接格式：

```text
https://example.com/online.html?room=ABC234
```

## 隐藏信息原则

在线版的真实飞机位置只保存在服务端。玩家视图只能获得：

- 自己的完整飞机布局；
- 双方已发生的攻击记录；
- 已击落敌机的公开轮廓；
- 比赛结束后的完整敌机布局。

未击落敌机的机头、方向、机身坐标以及内部 `planeId` 不会通过公共状态或攻击结果返回给对手。

## 房间持久化限制

V1 房间保存在服务端内存中：

- 无活动超过 6 小时会自动清理。
- 服务进程重启会清空当前房间。
- 玩家刷新页面不会丢失身份，只要服务端房间仍然存在即可恢复。

持久化房间、Redis、多实例水平扩展留到后续版本。

## Nginx 反向代理注意事项

部署在线版时需要允许 SSE 长连接并关闭代理缓冲：

```nginx
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

`/api/rooms/*/events` 响应本身也会发送 `X-Accel-Buffering: no` 和周期心跳。

## 测试

```bash
npm test
```

覆盖：

- 飞机几何与四向旋转；
- 越界 / 重叠 / 随机合法布局；
- MISS / HIT / DESTROYED / 胜负；
- 房间创建、加入、鉴权、准备、攻击、重赛和过期清理；
- 敌方隐藏信息隔离；
- 非法 HTTP 负载防护；
- SSE 状态广播；
- HTTP 攻击接口与公开结果清洗。
