FROM node:alpine
MAINTAINER OpenIAP ApS / Allan Zimmermann

WORKDIR /opt/openiap/mongo-k8s-sidecar

COPY package.json /opt/openiap/mongo-k8s-sidecar/package.json

RUN npm install --omit=optional
# kubernetes/client-node is broken !!!
RUN npm install openid-client

COPY ./src /opt/openiap/mongo-k8s-sidecar/src
COPY .foreverignore /opt/openiap/.foreverignore

CMD ["npm", "start"]

# docker build . -t openiap/mongo-k8s-sidecar:0.2.7 && docker push openiap/mongo-k8s-sidecar:0.2.7
# docker build . -t openiap/mongo-k8s-sidecar && docker push openiap/mongo-k8s-sidecar



# FROM node:alpine
# MAINTAINER OpenIAP ApS / Allan Zimmermann

# RUN apk --no-cache add shadow \
#     && groupadd -r openiapuser && useradd -r -g openiapuser -G audio,video openiapuser \
#     && mkdir -p /home/openiapuser /data \
#     && chown -R openiapuser:openiapuser /home/openiapuser \
#     && chown -R openiapuser:openiapuser /data/

# WORKDIR /data
# USER openiapuser

# COPY --chown=openiapuser:openiapuser package.json /data/package.json

# RUN npm install --omit=optional
# # kubernetes/client-node is broken !!!
# RUN npm install openid-client

# COPY --chown=openiapuser:openiapuser ./src /data/src
# COPY --chown=openiapuser:openiapuser .foreverignore /data/.foreverignore

# CMD ["npm", "start"]

# # docker build . -t openiap/mongo-k8s-sidecar:test && docker push openiap/mongo-k8s-sidecar:test
