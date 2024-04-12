var dns = require('dns');

var getMongoPodLabels = function() {
  return process.env.MONGO_SIDECAR_POD_LABELS || false;
};

var getMongoPodLabelCollection = function() {
  var podLabels = getMongoPodLabels();
  if (!podLabels) {
    return false;
  }
  var labels = process.env.MONGO_SIDECAR_POD_LABELS.split(',');
  for (var i in labels) {
    var keyAndValue = labels[i].split('=');
    labels[i] = {
      key: keyAndValue[0],
      value: keyAndValue[1]
    };
  }

  return labels;
};

var getMongoArbiterLabels = function() {
  return process.env.MONGO_SIDECAR_ARBITER_LABELS || false;
};

var getMongoArbiterLabelCollection = function() {
  var podLabels = getMongoArbiterLabels();
  if (!podLabels) {
    return false;
  }
  var labels = process.env.MONGO_SIDECAR_ARBITER_LABELS.split(',');
  for (var i in labels) {
    var keyAndValue = labels[i].split('=');
    labels[i] = {
      key: keyAndValue[0],
      value: keyAndValue[1]
    };
  }

  return labels;
};

var getk8sROServiceAddress = function() {
  return process.env.KUBERNETES_SERVICE_HOST + ":" + process.env.KUBERNETES_SERVICE_PORT
};

/**
 * @returns k8sClusterDomain should the name of the kubernetes domain where the cluster is running.
 * Can be convigured via the environmental variable 'KUBERNETES_CLUSTER_DOMAIN'.
 */
var getK8sClusterDomain = function() {
  var domain = process.env.KUBERNETES_CLUSTER_DOMAIN || "cluster.local";
  verifyCorrectnessOfDomain(domain);
  return domain;
};

/**
 * Calls a reverse DNS lookup to ensure that the given custom domain name matches the actual one.
 * Raises a console warning if that is not the case.
 * @param clusterDomain the domain to verify.
 */
var verifyCorrectnessOfDomain = function(clusterDomain) {
  if (!clusterDomain) {
    return;
  }

  var servers = dns.getServers();
  if (!servers || !servers.length) {
    console.log("dns.getServers() didn't return any results when verifying the cluster domain '%s'.", clusterDomain);
    return;
  }

  // In the case that we can resolve the DNS servers, we get the first and try to retrieve its host.
  dns.reverse(servers[0], function(err, host) {
    if (err) {
      console.warn("Error occurred trying to verify the cluster domain '%s'",  clusterDomain);
    }
    else if (host.length < 1 || !host[0].endsWith(clusterDomain)) {
      console.warn("Possibly wrong cluster domain name! Detected '%s' but expected similar to '%s'",  clusterDomain, host[0]);
    }
    else {
      console.log("The cluster domain '%s' was successfully verified.", clusterDomain);
    }
  });
};

/**
 * @returns mongoPort this is the port on which the mongo instances run. Default is 27017.
 */
var getMongoDbPort = function() {
  var mongoPort = process.env.MONGO_PORT || 27017;
  console.log("Using mongo port: %s", mongoPort);
  return mongoPort;
};
var getExternalPort = function() {
  var mongoPort = process.env.EXTERNAL_PORT || 27017;
  console.log("Using external port: %s", mongoPort);
  return mongoPort;
};


/**
 *  @returns boolean to define the RS as a configsvr or not. Default is false
 */
var isConfigRS = function() {
  var configSvr = (process.env.CONFIG_SVR || '').trim().toLowerCase();
  var configSvrBool = /^(?:y|yes|true|1)$/i.test(configSvr);
  if (configSvrBool) {
    console.log("ReplicaSet is configured as a configsvr");
  }

  return configSvrBool;
};

/**
 * @returns boolean
 */
var stringToBool = function(boolStr) {
  var isTrue = ( boolStr === 'true' ) || false;

  return isTrue;
};

module.exports = {
  namespace: process.env.KUBE_NAMESPACE,
  username: process.env.MONGODB_USERNAME,
  password: process.env.MONGODB_PASSWORD,
  database: process.env.MONGODB_DATABASE || 'local',
  rsname: process.env.MONGODB_RSNAME,
  isArbiter: process.env.MONGODB_IS_ARBITER,
  authdatabase: process.env.MONGODB_AUTH_DATABASE || 'admin',
  initusername: process.env.MONGODB_INITDB_USERNAME,
  initpassword: process.env.MONGODB_INITDB_PASSWORD,
  initdatabase: process.env.MONGODB_INITDB,
  authenabled: process.env.MONGO_AUTH_ENABLED,
  initdatabaserole: process.env.MONGODB_INITDB_ROLE || 'readWrite',
  initauthdb: process.env.MONGODB_INITDB_AUTH_Db || 'admin',
  external_domain: process.env.EXTERNAL_DOMAIN,
  tls_selfsign: process.env.TLS_SELFSIGN,
  tls_ca_private: process.env.TLS_CA_PRIVATE,
  tls_ca_cert: process.env.TLS_CA_CERT,
  tls_keyfile: process.env.TLS_KEYFILE,
  tls_keypassword: process.env.TLS_KEYPASSWORD,
  tls_cafile: process.env.TLS_CAFILE,
  tls_hosts: process.env.TLS_DNS_HOSTS,
  keyfile: process.env.MONGODB_KEYFILE,
  keyfilecontent: process.env.MONGODB_KEYFILE_CONTENT,
  keyfileuid: process.env.MONGODB_KEYFILEUID || "999",
  keyfilegid: process.env.MONGODB_KEYFILEGID || "999",
  skip_remote_check: process.env.SKIP_REMOTE_CHECK || false,
  hostip_override: process.env.HOSTIP_OVERRIDE,
  loopSleepSeconds: process.env.MONGO_SIDECAR_SLEEP_SECONDS || 5,
  unhealthySeconds: process.env.MONGO_SIDECAR_UNHEALTHY_SECONDS || 15,
  k8sMongoServiceName: process.env.KUBERNETES_MONGO_SERVICE_NAME || false,
  mongoSSLEnabled: stringToBool(process.env.MONGO_SSL_ENABLED),
  mongoSSLAllowInvalidCertificates: stringToBool(process.env.MONGO_SSL_ALLOW_INVALID_CERTIFICATES),
  mongoSSLAllowInvalidHostnames: stringToBool(process.env.MONGO_SSL_ALLOW_INVALID_HOSTNAMES),
  env: process.env.NODE_ENV || 'local',
  mongoPodLabels: getMongoPodLabels(),
  mongoPodLabelCollection: getMongoPodLabelCollection(),
  mongoArbiterLabels: getMongoArbiterLabels(),
  mongoArbiterLabelCollection: getMongoArbiterLabelCollection(),
  k8sROServiceAddress: getk8sROServiceAddress(),
  k8sClusterDomain: getK8sClusterDomain(),
  mongoPort: getMongoDbPort(),
  externalPort: getExternalPort(),
  isConfigRS: isConfigRS(),
};
