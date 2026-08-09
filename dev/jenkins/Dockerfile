FROM jenkins/jenkins:lts-jdk21

RUN jenkins-plugin-cli --plugins \
    cloudbees-folder \
    git \
    junit \
    pipeline-model-definition \
    pipeline-stage-view \
    rebuild \
    timestamper \
    workflow-aggregator

COPY --chown=jenkins:jenkins init.groovy.d/ /usr/share/jenkins/ref/init.groovy.d/
