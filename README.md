# Plane · 炸飞机

Plane 是一个 10×10 棋盘的坐标推理对战游戏。双方各部署 3 架固定形状飞机，轮流攻击坐标；击中机头会击落整架飞机，先击落对方全部 3 架者获胜。

## 在线体验

- [本地双人](https://plane.duanap.cn/)：同一设备轮流布阵和攻击，交接时隐藏对方布局。
- [在线双人](https://plane.duanap.cn/online.html)：创建房间并分享房间码，与另一台设备实时对战。
- [人机练习](https://plane.duanap.cn/ai.html)：选择简单、普通或困难难度。
- [服务健康检查](https://plane.duanap.cn/health)：服务正常时返回 `{"ok":true,"service":"plane"}`。

## 游戏模式

### 本地双人

两名玩家在同一设备上轮流完成布阵和攻击。每回合之间会显示隐私交接屏，避免下一位玩家看到对方战场。

### 人机练习

提供简单、普通和困难三档 AI。AI 决策只使用自己的公开攻击记录，不读取玩家实际布局：

- **简单**：从未攻击的位置中随机选择。
- **普通**：命中后优先搜索附近未攻击的位置。
- **困难**：根据 MISS、HIT 和已击落飞机的位置，筛选合法布局并估算机头概率。

困难 AI 使用公开信息进行概率推理，不会读取隐藏棋盘。

### 在线双人

服务端权威处理房间、布阵和攻击。飞机被击落前，对手不会收到其机头、方向、机身坐标或内部 `planeId`。在线模式支持 SSE 实时更新、断线重连、刷新后恢复身份和双方投票再来一局。

房间码为 6 位字符，排除容易混淆的 `0`、`1`、`I`、`O`。在线房间无活动 6 小时后自动清理。

## 核心规则

- 棋盘为 10×10，每位玩家部署 3 架飞机。
- 每架飞机由 1 个机头和 9 个机身格组成；翼展 5 格、身长 4 格、尾宽 3 格。
- 飞机可朝上、右、下、左四个方向旋转；不可越界或重叠，可以相邻。
- 攻击结果为 `MISS`、`HIT` 或 `DESTROYED`。击中机头会立即击落飞机并公开其位置。
- 重复攻击会被拒绝且不消耗回合；第三架飞机被击落后比赛结束，并公开双方战场。

## 本地开发

需要 Node.js 22 或更高版本。项目使用 TypeScript 5.8.3，浏览器和服务端代码均从 `src/` 构建。

```bash
git clone https://github.com/duanap/plane.git
cd plane
npm install
npm test
npm run build
npm start
```

默认服务地址为 `http://localhost:4173`：

- 本地双人：`/`
- 在线双人：`/online.html`
- 人机练习：`/ai.html`
- 健康检查：`/health`

服务默认监听 4173 端口。需要更换端口时，可在启动前设置 `PORT` 环境变量；例如 macOS/Linux 使用 `PORT=8080 npm start`，PowerShell 使用 `$env:PORT = "8080"; npm start`。

## 项目结构

```text
src/
  game/       飞机几何、布阵校验和回合规则
  ai/         AI 策略与人机对局状态
  online/     在线房间状态和客户端模型
  web/        本地、AI、在线模式的浏览器界面
scripts/      HTTP 服务、静态资源和 API 路由
public/       HTML 页面与样式
test/         游戏规则、AI、房间状态和 HTTP 接口测试
docs/         设计说明与开发计划
```

## 在线房间 API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/rooms` | 创建房间 |
| `POST` | `/api/rooms/:roomId/join` | 加入房间 |
| `GET` | `/api/rooms/:roomId/state?token=...` | 获取房间状态 |
| `POST` | `/api/rooms/:roomId/fleet` | 提交飞机布局 |
| `POST` | `/api/rooms/:roomId/ready` | 锁定布局并准备 |
| `POST` | `/api/rooms/:roomId/attack` | 攻击坐标 |
| `POST` | `/api/rooms/:roomId/rematch` | 投票再来一局 |
| `GET` | `/api/rooms/:roomId/events?token=...` | 订阅 SSE 状态更新 |

在线房间保存在服务进程内存中。进程重启会清空现有房间，但不会影响代码或静态文件；当前版本适合单实例运行，不提供 Redis/数据库持久化或多实例同步。

## Docker 部署

使用 Docker Compose 在本机启动：

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:4173/health
```

停止服务：

```bash
docker compose down
```

Compose 默认将宿主机 4173 端口映射到容器 4173 端口。可通过 `PORT` 更改宿主机端口。也可以直接构建和运行镜像：

```bash
docker build -t plane:v1 .
docker run -d --name plane --restart unless-stopped -p 4173:4173 plane:v1
```

镜像分为 builder 和 runtime 两个阶段：构建阶段执行测试和 TypeScript 构建，运行阶段只包含构建产物和服务脚本，并以非 root 用户运行。容器提供 `/health` 健康检查。

## Nginx 反向代理

在线对局通过 SSE 推送状态。反向代理需关闭响应缓冲，并为事件流保留足够长的读取超时：

```nginx
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

服务端也会为 SSE 响应发送 `X-Accel-Buffering: no` 和周期性心跳。

## CI 与测试

GitHub Actions 工作流会运行单元测试、TypeScript 构建和 Docker 镜像构建。可在本地使用：

```bash
npm test
npm run build
docker build -t plane:v1 .
```

测试覆盖飞机几何和布阵、攻击与胜负、三档 AI、AI 信息隔离、房间创建与鉴权、在线隐藏信息、非法请求处理、SSE 广播及 HTTP 接口。
