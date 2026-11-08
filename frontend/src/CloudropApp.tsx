import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Space, Typography } from "antd";
import { CloudSyncOutlined } from "@ant-design/icons";

import { fetchAuthStatus, logout } from "./api";
import { LockedScreen } from "./components/LockedScreen";
import { LoginScreen } from "./components/LoginScreen";
import { Workspace } from "./components/Workspace";


type Screen = "checking" | "login" | "workspace" | "locked";


export function CloudropApp() {
  const { message } = App.useApp();
  const [screen, setScreen] = useState<Screen>("checking");

  const refreshStatus = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setScreen(status.locked ? "locked" : status.authorized ? "workspace" : "login");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "无法连接服务器");
      setScreen("login");
    }
  }, [message]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } finally {
      setScreen("login");
    }
  }, []);

  if (screen === "checking") {
    return (
      <main className="centered-page">
        <Card className="status-card">
          <Space orientation="vertical" align="center" size="large">
            <CloudSyncOutlined className="loading-mark" spin />
            <Typography.Text type="secondary">正在检查服务器状态…</Typography.Text>
          </Space>
        </Card>
      </main>
    );
  }

  if (screen === "locked") return <LockedScreen />;
  if (screen === "login") {
    return (
      <LoginScreen
        onAuthorized={() => setScreen("workspace")}
        onLocked={() => setScreen("locked")}
      />
    );
  }
  return (
    <Workspace
      onLocked={() => setScreen("locked")}
      onUnauthorized={() => setScreen("login")}
      onLogout={handleLogout}
    />
  );
}
