import { Alert, Card, Space, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";


export function LockedScreen() {
  return (
    <main className="centered-page locked-page">
      <Card className="locked-card">
        <Space orientation="vertical" align="center" size="large">
          <div className="locked-mark"><LockOutlined /></div>
          <Typography.Title level={2}>服务器已锁定</Typography.Title>
          <Alert
            type="error"
            showIcon
            title="访问密码错误次数已达到安全阈值"
            description="服务器不再接受任何访问尝试。请由运维人员修改 CLOUDROP_ACCESS_PASSWORD 并重启服务。仅重启不会解除锁定。"
          />
        </Space>
      </Card>
    </main>
  );
}
