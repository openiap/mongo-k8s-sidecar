Original work, Copyright (c) 2015 Charles Vallance
https://github.com/cvallance/mongo-k8s-sidecar

New version, Copyright (c) 2022-2024 Allan Zimmermann

To debug locally, create a config folder and add a .env file and add any
relevant settings from https://github.com/open-rpa/helm-charts/blob/main/charts/mongodb/templates/deployment.yaml#L138
```
MONGODB_RSNAME=rs1
MONGO_SIDECAR_POD_LABELS=app=openflow-mongodb
MONGO_SIDECAR_ARBITER_LABELS=app=openflow-mongodb-arbiter
MONGODB_AUTH_DATABASE=admin
KUBE_NAMESPACE=openflow
TLS_KEYFILE=db/cert.pem
TLS_CAFILE=db/ca.pem
MONGODB_KEYFILE=db/mongodb.key
MONGODB_KEYFILEUID=999
MONGODB_KEYFILEGID=999
MONGODB_KEYFILE_CONTENT=...somekey...
KUBERNETES_MONGO_SERVICE_NAME=openflow-mongodb
MONGO_AUTH_ENABLED=false
MONGODB_USERNAME=adminusername
MONGODB_PASSWORD=secret
MONGODB_INITDB_ROLE=readWrite
MONGODB_INITDB=openflow
MONGODB_INITDB_AUTH_Db=openflow
MONGODB_INITDB_USERNAME=openflow
MONGODB_INITDB_PASSWORD=secret
```