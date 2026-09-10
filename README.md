# Plane · 炸飞机

一个 10×10 坐标推理对战小游戏。双方各部署 3 架固定形状飞机，轮流攻击坐标；命中机头即击落整架飞机，率先击落全部 3 架者获胜。

## V1 可玩模式

V1 已包含三种入口：

- **人机练习**：简单 / 普通 / 困难三档 AI。AI 决策只读取自己的公开攻击结果，不读取玩家真实飞机布局。
- **在线双人**：创建 6 位房间码，分享邀请链接，两台设备独立部署并实时对战。
- **本地双人**：同一设备 Hot-seat，对局阶段通过隐私交接屏避免看到对方布阵。

默认入口：

```text
本地双人：http://localhost:4173/
在线双人：http://localhost:4173/online.html
人机练习：http://localhost:4173/ai.html
健康检查：http://localhost:4173/health
```

## 核心规则

- 10×10 棋盘；每人固定 3 架飞机。
- 每架飞机 10 格：1 个机头 + 9 个机身；翼展 5、身长 4、尾宽 3。
- 上 / 右 / 下 / 左四向旋转，禁止出界和重叠，允许相邻。
- MISS / HIT / DESTROYED 三类攻击结果。
- 击中机头立即击落并公开整架飞机。
- 重复攻击被拒绝且不消耗回合。
- 第三架飞机被击落后立即结束比赛，并公开双方完整战场。

## AI 公平原则

`chooseAiAttack()` 只接受：

```text
难度
AI 自己的公开攻击观察（MISS / HIT / DESTROYED）
随机源
```

它没有玩家真实舰队参数。

三档策略：

- **简单**：从未攻击坐标中随机选择。
- **普通**：出现 HIT 后优先搜索未攻击的邻近坐标。
- **困难**：枚举所有合法单机位置，根据 MISS / HIT / 已击落残骸过滤和加权，优先选择机头概率较高的未攻击坐标。

困难 AI 是 V1 的快速概率推理器，并非读取隐藏棋盘的作弊 AI。

## 在线模式

在线版由服务端权威判定。真实飞机位置只保存在服务端；对手客户端在飞机被击落前不会收到其机头、方向、机身坐标或内部 `planeId`。

在线房间支持：

- SSE 实时状态更新；
- 断线自动重连；
- 刷新后凭玩家 token 恢复身份；
- 双方投票再来一局；
- 无活动 6 小时后自动清理。

房间码使用 6 位字符，并排除 `0 / 1 / I / O`。邀请链接格式：

```text
https://example.com/online.html?room=ABC234
```

### 在线房间 API

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

## 本地开发

要求：

```text
Node.js 22+
TypeScript 5.8.3
```

执行：

```bash
npm install
npm test
npm run build
npm start
```

自定义端口：

```bash
PORT=8080 npm start
```

## Docker 部署

### Docker Compose（推荐）

```bash
git clone https://github.com/duanap/plane.git
cd plane
git checkout dev/v1-core
PORT=4173 docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

健康检查：

```bash
curl http://127.0.0.1:4173/health
```

停止：

```bash
docker compose down
```

### 直接 Docker

```bash
docker build -t plane:v1 .
docker run -d \
  --name plane \
  --restart unless-stopped \
  -p 4173:4173 \
  plane:v1
```

容器内部固定监听 `4173`；Compose 的 `PORT` 用于控制宿主机映射端口。

Docker 镜像采用多阶段构建：builder 阶段执行测试和 TypeScript build；runtime 阶段只携带构建产物与 Node 服务脚本，并以非 root `node` 用户运行。容器自带 `/health` 健康检查。

## Nginx 反向代理

在线 SSE 需要关闭代理缓冲：

```nginx
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

`/api/rooms/*/events` 响应也会发送 `X-Accel-Buffering: no` 和周期心跳。

## 数据持久化限制

V1 在线房间保存在服务端内存中：

- 无活动超过 6 小时自动清理；
- 服务进程或容器重启会清空当前在线房间；
- 浏览器刷新不会丢身份，只要服务端房间仍存在即可恢复。

因此 V1 推荐单实例部署。Redis / 数据库持久化和多实例水平扩展属于后续版本。

## CI

`.github/workflows/ci.yml` 会在 `dev/v1-core` push 以及针对 `main` 的 Pull Request 上执行：

```text
npm install
npm test
npm run build
docker build
```

只有测试、TypeScript 构建和生产 Docker 镜像构建全部通过，才应将版本视为可部署候选。

## 测试覆盖

```bash
npm test
```

覆盖：

- 飞机几何、四向旋转、越界、重叠和随机合法布局；
- MISS / HIT / DESTROYED / 胜负；
- Easy / Normal / Hard AI 决策与重复攻击保护；
- AI Session 回合和公开观察隔离；
- 房间创建、加入、鉴权、准备、攻击、重赛和过期清理；
- 在线敌方隐藏信息隔离；
- 非法 HTTP 负载防护；
- SSE 状态广播；
- HTTP 攻击接口与公开结果清洗。
