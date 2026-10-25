FROM node:24.18.0-bookworm AS node

FROM jenkins/jenkins:lts-jdk21

RUN jenkins-plugin-cli --plugins \
    cloudbees-folder \
    coverage \
    git \
    git-forensics \
    junit \
    pipeline-model-definition \
    pipeline-stage-view \
    timestamper \
    workflow-aggregator \
    workflow-multibranch

USER root
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
# Jobs use a realistic remote URL; git rewrites it to the bare repository mounted from the host.
RUN git config --system --add safe.directory '*' \
    && git config --system url."file:///srv/git/".insteadOf "https://git.acme.dev/acme/" \
    && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# /var/jenkins_home is a volume, so the offline npm cache lives outside it.
ENV npm_config_cache=/opt/npm-cache
COPY --from=project-deps package.json package-lock.json /tmp/storefront-deps/
RUN mkdir -p /opt/npm-cache \
    && cd /tmp/storefront-deps \
    && npm ci --no-audit --no-fund \
    && rm -rf /tmp/storefront-deps \
    && chown -R jenkins:jenkins /opt/npm-cache
USER jenkins

COPY --chown=jenkins:jenkins init.groovy.d/ /usr/share/jenkins/ref/init.groovy.d/
