
## 技术架构

### 后台
Python 3.11 + Django 5.2 + Django REST Framework

### 前端

| 项 | 锁定版本 | 落地位置 |
| --- | --- | --- |
| Node.js | 24.22.2（LTS） | `.nvmrc`、`.node-version`、`package.json` 的 `engines` / `volta`、`scripts/check-node.mjs` |
| pnpm | 11.1.2 | `package.json` 的 `packageManager` |
| Vite | 7.3.7 | `devDependencies` |
| React / React-DOM | 19.2.9 | `dependencies`（类型按 19.2 线对齐：`@types/react` 19.2.18、`@types/react-dom` 19.2.7） |
| TypeScript | 5.9.3 | `devDependencies` |
| @vitejs/plugin-react | 5.2.0 | 支持 Vite 7 的最新线（6.x 起要求 Vite 8） |