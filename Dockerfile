FROM oven/bun:1-alpine

RUN apk add --no-cache git openssh-client && \
    adduser -D -h /home/monitor monitor && \
    mkdir -p /home/monitor/.ssh && \
    ssh-keyscan github.com >> /home/monitor/.ssh/known_hosts 2>/dev/null && \
    chown -R monitor:monitor /home/monitor

USER monitor
WORKDIR /home/monitor

EXPOSE 3000

CMD ["sh", "-c", "\
  echo \"$DEPLOY_KEY_B64\" | base64 -d > /home/monitor/.ssh/id_ed25519 && \
  chmod 600 /home/monitor/.ssh/id_ed25519 && \
  rm -rf /home/monitor/repo && \
  git clone --single-branch --branch main git@github.com:${GITHUB_REPO}.git /home/monitor/repo && \
  cd /home/monitor/repo && \
  git config user.name \"${GIT_USER_NAME:-GooSledgeChad}\" && \
  git config user.email \"${GIT_USER_EMAIL:-gooslede@proton.me}\" && \
  git fetch origin ${TAMPER_BRANCH:-tamper-log} && \
  git checkout -b ${TAMPER_BRANCH:-tamper-log} FETCH_HEAD && \
  git branch --set-upstream-to=origin/${TAMPER_BRANCH:-tamper-log} ${TAMPER_BRANCH:-tamper-log} && \
  git checkout main -- package.json bun.lock src/ data/ && \
  bun install --frozen-lockfile && \
  bun run monitor \
"]