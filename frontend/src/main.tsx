import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";

import { CloudropApp } from "./CloudropApp";
import "./styles.css";


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#0f766e",
          colorInfo: "#0f766e",
          borderRadius: 12,
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Card: { headerBg: "transparent" },
          Button: { primaryShadow: "none" },
        },
      }}
    >
      <AntApp>
        <CloudropApp />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);

