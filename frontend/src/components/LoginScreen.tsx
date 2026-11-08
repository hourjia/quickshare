import { useState } from "react";
import { App, Button, Card, Form, Input, Space, Typography } from "antd";
import { LockOutlined, SafetyCertificateOutlined } from "@ant-design/icons";

import { login } from "../api";


interface LoginScreenProps {
  onAuthorized: () => void;
  onLocked: () => void;
}


export function LoginScreen({ onAuthorized, onLocked }: LoginScreenProps) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const submit = async ({ password }: { password: string }) => {
    setLoading(true);
    try {
      const result = await login(password);
      if (result.locked) {
        onLocked();
        return;
      }
      if (result.authorized) {
        message.success("验证成功");
        onAuthorized();
        return;
      }
      message.error("验证失败");
    } catch {
      message.error("验证失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="centered-page login-page">
      <section className="brand-block" aria-label="快分享">
        <div className="brand-mark"><SafetyCertificateOutlined /></div>
        <Typography.Title level={1}>快分享</Typography.Title>
        <Typography.Paragraph type="secondary">
          无账户、点对点、即时传输
        </Typography.Paragraph>
      </section>
      <Card className="login-card" title="访问验证">
        <Form layout="vertical" requiredMark={false} onFinish={submit} size="large">
          <Form.Item
            name="password"
            rules={[{ required: true, message: "请输入访问密码" }]}
          >
            <Input.Password
              autoFocus
              autoComplete="current-password"
              prefix={<LockOutlined />}
              placeholder="请输入密码"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            进入快分享
          </Button>
        </Form>
      </Card>
    </main>
  );
}
