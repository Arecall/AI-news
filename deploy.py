import os
import sys
import paramiko

def main():
    hostname = os.environ["DEPLOY_HOST"]
    username = "root"
    password = os.environ["DEPLOY_PASSWORD"]

    local_archive = "news-index.tar.gz"
    remote_archive = "/root/news-index.tar.gz"
    remote_dir = "/root/news-index"

    print("Connecting to server...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(hostname, username=username, password=password, timeout=30)
    except Exception as e:
        print(f"Failed to connect: {e}")
        sys.exit(1)

    print("Uploading archive...")
    sftp = ssh.open_sftp()
    try:
        sftp.put(local_archive, remote_archive)
        sftp.close()
    except Exception as e:
        print(f"Failed to upload: {e}")
        ssh.close()
        sys.exit(1)

    print("Extracting and running docker-compose on remote server...")
    commands = [
        f"mkdir -p {remote_dir}",
        f"tar -xzf {remote_archive} -C {remote_dir}",
        f"rm -f {remote_archive}",
        f"cd {remote_dir}",
        # 确保服务器上安装了 docker 和 docker-compose
        "which docker || (curl -fsSL https://get.docker.com | bash)",
        "which docker-compose || (curl -L 'https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)' -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose)",
        # 启动 docker 服务以防万一
        "systemctl start docker || service docker start || true",
        # 停止可能正在运行的老容器并构建运行新容器
        "cd /root/news-index && docker-compose down || true",
        "cd /root/news-index && docker-compose up -d --build"
    ]

    # 串行执行命令
    full_cmd = " && ".join(commands)
    # 用独立命令组合执行
    cmd = f"bash -c 'mkdir -p {remote_dir} && tar -xzf {remote_archive} -C {remote_dir} && rm -f {remote_archive} && cd {remote_dir} && (which docker || curl -fsSL https://get.docker.com | bash) && (which docker-compose || (curl -L \"https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)\" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose)) && (systemctl start docker || service docker start || true) && (docker-compose down || docker compose down || true) && (docker-compose up -d --build || docker compose up -d --build)'"

    print(f"Executing remote deployment script...")
    stdin, stdout, stderr = ssh.exec_command(cmd)

    # 获取输出
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')

    print("Remote Output:")
    print(out)
    if err:
        print("Remote Errors/Warnings:")
        print(err)

    ssh.close()
    print("Deployment completed!")

if __name__ == "__main__":
    main()
