const { lookup } = require("dns").promises;
const { hostname } = require("os");
const config = require("./config");
const { MongoClient } = require("mongodb");
const fs = require("fs");
const { dirname } = require("path");
const forge = require("node-forge");
const crypto = require("crypto");
const package = require("../package.json");

function log(message) {
  var dt = new Date();
  let dts = (dt.getHours().toString().padStart(2, "0")) + ":" + (dt.getMinutes().toString().padStart(2, "0")) + ":" +
    (dt.getSeconds().toString().padStart(2, "0")) + "." + (dt.getMilliseconds().toString().padStart(3, "0"));
  console.log((dts.padEnd(13, " ") + " " + message));
}
log("Starting up mongo-k8s-sidecar version " + package.version);
var hostIpAndPort = null;
var hostIp = null;
var k8sApi = null;
var cli = null;
var firstrun = true;
var healthy = true;
async function init() {
  hostIp = await getMyIPAddress(null);
  hostIpAndPort = hostIp + ":" + config.mongoPort;
  log("hostIpAndPort " + hostIpAndPort)


  if(config.tls_cafile && config.tls_ca_cert && config.tls_ca_private) {
    var dir = require('path').dirname(config.tls_cafile)
    if (!fs.existsSync(dir)) {
      log("create path " + dir)
      fs.mkdirSync(dir, { recursive: true });
    }
    const _path = require('path');
    const privatepath = _path.join(dir, "ca-private.pem");
    const capath = _path.join(dir, "ca.pem");
    const ca = Buffer.from(config.tls_ca_cert, 'base64')
    var t = ca.toString()
    t = t.split("\\r\\n").join('\r\n')
    fs.writeFileSync(capath, t, { encoding: "utf-8" });
    const pri = Buffer.from(config.tls_ca_private, 'base64')
    var t = pri.toString()
    fs.writeFileSync(privatepath, t, { encoding: "utf-8" });  
  }

  if (config.tls_selfsign) {
    var path = require('path').dirname(config.tls_cafile)

    // var dirCont = fs.readdirSync(path);
    // for (var i = 0; i < dirCont.length; i++) {
    //   var filepath = require('path').join(path, dirCont[i]);
    //   fs.unlinkSync(filepath);
    // }

    // https://www.mongodb.com/docs/manual/appendix/security/appendixB-openssl-server/

    // https://www.mongodb.com/community/forums/t/unable-to-connect-to-mongodb-using-ssl-tls/117797/5
    // echo Q | openssl s_client -showcerts -connect mongo-0.demo3.openiap.io:27017
    // echo Q | openssl s_client -showcerts -connect localhost:27017
    // openssl x509 -in  /home/allan/code/mongo-k8s-sidecar/tls/ca.pem -noout -subject -issuer
    // openssl x509 -in  /home/allan/code/mongo-k8s-sidecar/tls/cert.pem -noout -subject -issuer
    // openssl verify -purpose sslclient -CAfile /home/allan/code/mongo-k8s-sidecar/tls/ca.pem /home/allan/code/mongo-k8s-sidecar/tls/cert.pem
    // https://stackoverflow.com/questions/41635371/mongodb-self-signed-ssl-connection-ssl-peer-certificate-validation-failed

    // https://abd-fl-19999.medium.com/build-csr-certificates-and-in-house-ca-in-nodejs-from-scratch-f40b8018f77
    // https://github.com/Mastercard/client-encryption-nodejs/blob/512b7ffd30d951de3b3d7c965171a7c5627a2423/lib/mcapi/crypto/crypto.js#L265
    var cipher = undefined, passphrase = undefined;
    if (config.tls_keypassword && config.tls_keypassword != "") {
      cipher = "aes-256-cbc";
      passphrase = config.tls_keypassword;
    }
    doGenerateCertificate(path, cipher, passphrase);
    // 
    const {
      privateKey,
      publicKey,
    } = generatePublicPrivatePairOfKeys(cipher, passphrase);
    var cert = createCSR(privateKey, publicKey, 20, passphrase, path);
    verifyCertificate(cert, path);
    var dirCont = fs.readdirSync(path);
    for (var i = 0; i < dirCont.length; i++) {
      file = dirCont[i];
      if (file.endsWith(".pem")) {
        // try {
        //   var filepath = require('path').join(path, file);
        //   fs.chownSync(filepath, parseInt(config.keyfileuid), parseInt(config.keyfilegid));
        // } catch (error) {
        //   log("error updating owner ship on " + file + " to " + config.keyfileuid + ":" + config.keyfilegid + ": " + (error.message ? error.message : error))
        // }
        // try {
        //   fs.chmodSync(filepath, 0o600)
        // } catch (error) {
        //   log("error updating permissions ship on " + config.keyfile + " to 600: " + (error.message ? error.message : error))
        // }
      }
    }
    // process.exit(0);
  }

  if (config.keyfile && config.keyfile != "") {
    if (config.keyfilecontent && config.keyfilecontent != "") {
      var dir = dirname(config.keyfile)
      if (!fs.existsSync(dir)) {
        log("create path " + dir)
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(config.keyfile, config.keyfilecontent);
    }

    if (fs.existsSync(config.keyfile)) {
      if (config.keyfileuid && config.keyfilegid && config.keyfileuid != "" && config.keyfilegid != "")
        try {
          fs.chownSync(config.keyfile, parseInt(config.keyfileuid), parseInt(config.keyfilegid));
        } catch (error) {
          log("error updating owner ship on " + config.keyfile + " to " + config.keyfileuid + ":" + config.keyfilegid + ": " + (error.message ? error.message : error))
        }
      try {
        fs.chmodSync(config.keyfile, 0o600)
      } catch (error) {
        log("error updating permissions ship on " + config.keyfile + " to 600: " + (error.message ? error.message : error))
      }
      // do this ?
      // 
    }
  }

  log("Connect to kubernetes")
  const k8s = require("@kubernetes/client-node");
  const kc = new k8s.KubeConfig();
  let success = false;
  try {
    kc.loadFromDefault();
    success = true;
  } catch (error) {
    console.error(error);
  }
  if (success == false) {
    try {
      kc.loadFromCluster();
      success = true;
    } catch (error) {
      console.error(error);
    }
  }
  k8sApi = kc.makeApiClient(k8s.CoreV1Api);
}
var errorcounter = 0;
var invalid_config = false;
async function workloop() {
  if (config.isArbiter) return finish(); // NOOP
  try {
    if (!hostIpAndPort || hostIpAndPort == "") {
      throw new Error("Must initialize with the host machine\"s addr");
    }
    if (!config.namespace || config.namespace == "") config.namespace = "demo3";
    var pods = await GetPods(config.namespace);
    const errEvent = (error) => {
      errorcounter++;
      console.error("workloop GetPods error #" + errorcounter, error);
    }

    cli = await Connect();
    cli.on("error", errEvent)
    // secondaryPreferred

    //Lets remove any pods that aren"t running or haven"t been assigned an IP address yet
    for (var i = pods.length - 1; i >= 0; i--) {
      var pod = pods[i];
      if (pod.status.phase !== "Running" || !pod.status.podIP) {
        pods.splice(i, 1);
      }
    }

    if (!pods.length || pods.length == 0) {
      console.log("No pods are currently running, probably just give them some time.");
      return finish("No pods are currently running, probably just give them some time.");
    }

    var mongoerror = null;
    var status = null;
    try {
      invalid_config = false;
      status = await cli.db(config.database).admin().command({ replSetGetStatus: {} }, {});
    } catch (error) {
      healthy = false;
      mongoerror = error;
    }
    if (mongoerror != null) {
      if (mongoerror.code == 94) {
        await notInReplicaSet(pods);
      } else if (mongoerror.code == 93) {
        invalid_config = true;
        log("Invalid replica set: " + mongoerror.message);
        laststate = -2; // no need to spam connection message
        await invalidReplicaSet(pods, status);
      } else {
        console.error((mongoerror.message ? mongoerror.message : mongoerror), mongoerror.code);
      }
      return finish();
    }
    if ((await inReplicaSet(pods, status)) == true) {
      if (!healthy) {
        log("Replicaset is now healthy");
        healthy = true;
      }

      // all has been setup, and is first run 
      if (!config.initdatabase || config.initdatabase == "") config.initdatabase = false;
      if (!config.initusername || config.initusername == "") config.initusername = false;
      if (!config.initpassword || config.initpassword == "") config.initpassword = false;
      if (config.authdatabase && config.authdatabase != "" && config.username && config.username != "" && config.password && config.password != "") {
        // Pre-create user.  Incase someone started a replica set without auth, and then later decide to enable it
        await AddUser(config.authdatabase, config.authdatabase, config.username, config.password, "root")
      } else {
        // log("skip admin user check authdatabase: " + config.authdatabase + " username: " + config.username + " password: " + config.password);
      }
      if (firstrun && config.initdatabase && config.initusername && config.initpassword) {
        try {
          var dbs = [];
          if (!config.authdatabase || config.authdatabase == "") config.authdatabase = "admin";
          dbs.push(config.authdatabase);
          if (config.initauthdb != null && config.initauthdb != "" && config.initauthdb != config.authdatabase) dbs.push(config.initauthdb);
          for (var y = 0; y < dbs.length; y++) {
            await AddUser(dbs[y], config.initdatabase, config.initusername, config.initpassword, config.initdatabaserole)
          }
          firstrun = false;
          // log("firstrun script completed")

        } catch (error) {
          errorcounter++;
          console.error("First run script error: " + (error.message ? error.message : error))
        }
      } else {
        // Test connection
        var db = cli.db(config.authdatabase);
        var exists = await db.admin().command({ usersInfo: { user: "something", db: "admin" } }, {});
        errorcounter = 0;
      }
    }
  } catch (error) {
    healthy = false;
    errorcounter++;
    laststate = -1;
    // console.error("error #" + errorcounter, error);
    console.error("workloop error #" + errorcounter + " " + (error.message ? error.message : error));
  }
  finish();
}
function finish() {
  if (cli != null) {
    cli.removeAllListeners();
    cli.close(true);
    cli = null;
  }
  // log("complete, wait " + config.loopSleepSeconds + " seconds and run again")
  setTimeout(workloop, config.loopSleepSeconds * 1000);
}
async function main() {
  try {
    await init();
    await workloop();
  } catch (error) {
    console.error("Error trying to initialize mongo-k8s-sidecar", error);
  }
}
main();

async function GetPods(namespace) {
  return new Promise(async (resolve) => {
    var pods = await k8sApi.listNamespacedPod(namespace);
    var labels = config.mongoPodLabelCollection;
    var results = [];
    for (var i in pods.body.items) {
      var pod = pods.body.items[i];
      if (podContainsLabels(pod, labels)) {
        if (pod.status.phase == "Running" && pod.status.podIP) {
          results.push(pod);
        }
      }
    }
    var labels = config.mongoArbiterLabelCollection;
    for (var i in pods.body.items) {
      var pod = pods.body.items[i];
      if (podContainsLabels(pod, labels)) {
        if (pod.status.phase == "Running" && pod.status.podIP) {
          results.push(pod);
        }
      }
    }

    resolve(results);
  })
}
function podContainsLabels(pod, labels) {
  if (!pod.metadata || !pod.metadata.labels) return false;
  for (var i in labels) {
    var kvp = labels[i];
    if (!pod.metadata.labels[kvp.key] || pod.metadata.labels[kvp.key] != kvp.value) {
      return false;
    }
  }
  return true;
};
async function Connect(host = "127.0.0.1") {
  mongodburl = "mongodb://"
  if (config.username && config.password && config.authenabled && (config.authenabled.toLowerCase() == "true" || config.authenabled.toLowerCase() == "1")) {
    mongodburl += config.username + ":" + config.password + "@"
  }
  mongodburl += host + ":" + config.mongoPort + "/admin?directConnection=true"
  if (config.authdatabase) mongodburl += "&authSource=" + config.authdatabase
  if (errorcounter > 2) mongodburl += "&readPreference=secondaryPreferred"
  if (config.mongoSSLEnabled) mongodburl += "&tls=true"
  if (laststate == -1) log("Connect to mongodb " + mongodburl.replace(config.password, "****"))
  var cli = await MongoClient.connect(mongodburl);
  return cli;
}
async function AddUser(authdb, database, username, password, dbrole) {
  var db = cli.db(authdb);
  // log("check if " + username + " has " + dbrole + " role for " + database + " in " + authdb);
  var exists = await db.admin().command({ usersInfo: { user: username, db: authdb } }, {});
  if (!exists.users || exists.users.length == 0) {
    log(username + " is missing from " + authdb + " so adding with " + dbrole + " to " + database)
    await db.addUser(username, password,
      {
        roles: [{ role: dbrole, db: database }]
      })
  } else {
    var found = false;
    for (var i = 0; i < exists.users[0].roles.length; i++) {
      if (exists.users[0].roles[i].db == database && exists.users[0].roles[i].role == dbrole) {
        found = true;
      }
    }
    if (!found) {
      await db.command({ grantRolesToUser: username, roles: [{ role: dbrole, db: database }] });
    }
  }
}
async function notInReplicaSet(pods) {
  //If we're not in a rs and others ARE in the rs, just continue, another path will ensure we will get added
  //If we're not in a rs and no one else is in a rs, elect one to kick things off

  if (podElection(pods)) {

    for (var i in pods) {
      var pod = pods[i];

      if (pod.status.phase === "Running") {
        if (await isInReplSet(pod.status.podIP) == true) {
          //There's one in a rs, nothing to do
          return;
        }
      }
    }

    log("Pod has been elected for replica set initialization");
    var primary = pods[0]; // After the sort election, the 0-th pod should be the primary.
    var primaryStableNetworkAddressAndPort = getPodStableNetworkAddressAndPort(primary);
    // Prefer the stable network ID over the pod IP, if present.
    var primaryAddressAndPort = primaryStableNetworkAddressAndPort || hostIpAndPort;
    await initReplSet(primaryAddressAndPort);
    return;
  }
}
async function invalidReplicaSet(pods, status) {
  // The replica set config has become invalid, probably due to catastrophic errors like all nodes going down
  // this will force re-initialize the replica set on this node. There is a small chance for data loss here
  // because it is forcing a reconfigure, but chances are recovering from the invalid state is more important
  var members = [];
  if (status && status.members) {
    members = status.members;
  }
  if (!podElection(pods)) {
    log("Didn't win the pod election, doing nothing");
    return;
  }

  log("Won the pod election, forcing re-initialization");
  var addrToRemove = addrToRemoveLoop(members);
  var addrToAdd = await addrToAddLoop(pods, members, addrToRemove);
  if (addrToAdd.length > 0 || addrToRemove > 0) {
    log("Addresses to add:    " + JSON.stringify(addrToAdd));
    log("Addresses to remove: " + JSON.stringify(addrToRemove));
  }
  await addNewReplSetMembers(pods, addrToAdd, addrToRemove, true);
};
async function initReplSet(hostIpAndPort) {
  // log("initReplSet", hostIpAndPort);
  // var rsConfig = {
  //   _id: config.rsname,
  //   members: [{ _id: 0, host: hostIpAndPort }]
  // }
  // await cli.db(config.database).admin().command({ replSetInitiate: rsConfig }, {});
  // if init with external host name, then we risk the replica set becomes invalid due to connection issues
  // and it refuses to get update since we become secondary, so we init with out host, to ensure we are primary
  // and then let it "error out" until all external hosts are valid and can be add'ed.
  log("initReplSet: initialize");
  await cli.db(config.database).admin().command({ replSetInitiate: {} }, {});
  var rsConfig = await replSetGetConfig(cli);
  rsConfig.configsvr = config.isConfigRS;
  rsConfig.members[0].host = hostIpAndPort;
  log("Reconfigure with " + hostIpAndPort);
  await replSetReconfig(rsConfig, false);
};
var laststate = -1;
var lastPrimaryName = null;
async function inReplicaSet(pods, status) {
  //If we're already in a rs and we ARE the primary, do the work of the primary instance (i.e. adding others)
  //If we're already in a rs and we ARE NOT the primary, just continue, nothing to do
  //If we're already in a rs and NO ONE is a primary, elect someone to do the work for a primary
  var members = status.members;
  var primaryExists = false;
  var primaryName = "";
  for (var i in members) {
    var member = members[i];
    if (member.state === 1) {
      if (member.self) {
        await primaryWork(pods, status, false);
        if (laststate != 0) {
          laststate = 0;
          primaryName = member.name;
          log("This pod is now primary and will do primary work (" + primaryName + ")");
        }
        return true;
      } else {
        primaryName = member.name;
      }
      primaryExists = true;
      break;
    }
  }
  if (!primaryExists && podElection(pods)) {
    if (laststate != 1) {
      log("No primary node, this pod has been elected as a secondary to do primary work");
      laststate = 1;
      lastPrimaryName = null;
    }
    return await primaryWork(pods, status, true);
  } else if (primaryExists) {
    if (laststate != 2 || lastPrimaryName != primaryName) {
      laststate = 2;
      lastPrimaryName = primaryName;
      log("We have a primary, and it\"s not me (" + primaryName + ")");
    }
  } else {
    if (laststate != 3) {
      laststate = 3;
      lastPrimaryName = null;
      log("We do not have a primary but I was not elected.");
    }
  }
  return false;
}



async function primaryWork(pods, status, shouldForce) {
  //Loop over all the pods we have and see if any of them aren't in the current rs members array
  //If they aren't in there, add them
  var addrToRemove = addrToRemoveLoop(status.members);
  var addrToAdd = await addrToAddLoop(pods, status.members, addrToRemove);

  if (addrToAdd.length || addrToRemove.length) {
    if(errorcounter > 3) {
      log("Had more than 3 errors, so we will try forcing reconfig");
      shouldForce = true;
    }
    log("Addresses to add:    " + JSON.stringify(addrToAdd));
    log("Addresses to remove: " + JSON.stringify(addrToRemove));

    await addNewReplSetMembers(pods, addrToAdd, addrToRemove, shouldForce);
  }
  return true;
};
async function addNewReplSetMembers(pods, addrToAdd, addrToRemove, shouldForce) {
  // if(addrToAdd.length == 0 && addrToRemove.length == 0 && !shouldForce ) return;
  if (addrToAdd.length == 0 && addrToRemove.length == 0) return;
  var rsConfig = await replSetGetConfig(cli);
  removeDeadMembers(rsConfig, addrToRemove);
  addNewMembers(rsConfig, pods, addrToAdd);
  await replSetReconfig(rsConfig, shouldForce);
}

async function getMyIPAddress(options) {
  if (config.hostip_override && config.hostip_override != "") return config.hostip_override;
  log("lookup " + hostname())
  return (await lookup(hostname(), options)).address;
}

async function replSetGetConfig(cli) {
  var status = await cli.db(config.database).admin().command({ replSetGetConfig: 1 }, {});
  return status.config;
}
async function replSetReconfig(rsConfig, force) {
  log("Update replicaSet Config, force: " + force + " with " + rsConfig.members.length + " members");
  // log("replSetReconfig" + JSON.stringify(rsConfig));
  rsConfig.version++;
  await cli.db(config.database).admin().command({ replSetReconfig: rsConfig, force: force }, {});
};

async function addrToAddLoop(pods, members, addrToRemove) {
  var addrToAdd = [];
  for (var i in pods) {
    var pod = pods[i];
    if (pod.status.phase !== "Running") {
      continue;
    }

    var podIpAddr = getPodIpAddressAndPort(pod);
    var podStableNetworkAddr = getPodStableNetworkAddressAndPort(pod);
    var podInRs = false;

    for (var j in members) {
      var member = members[j];
      if (member.name === podIpAddr || member.name === podStableNetworkAddr) {
        /* If we have the pod's ip or the stable network address already in the config, no need to read it. Checks both the pod IP and the
        * stable network ID - we don't want any duplicates - either one of the two is sufficient to consider the node present. */
        podInRs = true;
        break;
      }
    }

    if (!podInRs) {
      var arbiterOnly = false;
      var labels = config.mongoArbiterLabelCollection;
      if (podContainsLabels(pod, labels)) {
        arbiterOnly = true;
      }
      // If the node was not present, we prefer the stable network ID, if present.
      var addrToUse = podStableNetworkAddr || podIpAddr;

      // Assume this is PSA ( one primary, one secondary, one arbiter)
      // we cannot add arbiter until primary and secondary has been added
      if (members.length < 2 && arbiterOnly) {
        log("we cannot add arbiter until primary and secondary has been added, skip " + addrToUse)
        continue;
      }
      // If errors happended and we are removing members, then skip adding arbiter
      if (addrToRemove.length > 0 && arbiterOnly) {
        log("Refuse to add arbiter while also removing a host, skip " + addrToUse)
        continue;
      }
      if (arbiterOnly && members.length == 2) {
        console.warn("Assuming we are in PSA mode, so updating defaultWriteConcern to 1 to avoid having to call rs.reconfigForPSASet")
        // {setDefaultRWConcern: 1, defaultWriteConcern: {w: "majority"}, writeConcern: {w: "majority"}})
        var status = await cli.db(config.database).admin().command({
          "setDefaultRWConcern": 1,
          "defaultWriteConcern": { "w": 1 }
        }, {});
      }

      addrToAdd.push(addrToUse);
      pod.addrToUse = addrToUse;
    }
  }
  return addrToAdd;
};
/**
 * @param pod this is the Kubernetes pod, containing the info.
 * @returns string - podIp the pod's IP address with the port from config attached at the end. Example
 * WWW.XXX.YYY.ZZZ:27017. It returns undefined, if the data is insufficient to retrieve the IP address.
 */
var getPodIpAddressAndPort = function (pod) {
  if (!pod || !pod.status || !pod.status.podIP) {
    return;
  }

  return pod.status.podIP + ":" + config.mongoPort;
};

/**
 * Gets the pod's address. It can be either in the form of
 * '<pod-name>.<mongo-kubernetes-service>.<pod-namespace>.svc.cluster.local:<mongo-port>'. See:
 * <a href="https://kubernetes.io/docs/concepts/abstractions/controllers/statefulsets/#stable-network-id">Stateful Set documentation</a>
 * for more details. If those are not set, then simply the pod's IP is returned.
 * @param pod the Kubernetes pod, containing the information from the k8s client.
 * @returns string the k8s MongoDB stable network address, or undefined.
 */
var getPodStableNetworkAddressAndPort = function (pod) {
  if (!pod || !pod.metadata || !pod.metadata.name || !pod.metadata.namespace) {
    return;
  }
  var result = getPodStableNetworkAddress(pod);
  if (!result) return;
  return result + ":" + config.externalPort;
};
var getPodStableNetworkAddress = function (pod) {
  if (!pod || !pod.metadata || !pod.metadata.name || !pod.metadata.namespace) {
    return;
  }
  var labels = config.mongoArbiterLabelCollection;
  // arbiter does not need external domain ... 
  if (podContainsLabels(pod, labels)) {
    arbiterOnly = true;
    // use ip 
    return;
  }
  // ok, bad idear, lets not anyway
  // } else if(invalid_config) {
  //   // if config is invalid, try "kick starting it" using local names
  //   if (!config.k8sMongoServiceName) {
  //     return pod.metadata.name
  //     // return pod.metadata.name + "." + pod.metadata.namespace + ".svc." + clusterDomain;
  //   } else {
  //     return pod.metadata.name + "." + config.k8sMongoServiceName
  //     // return pod.metadata.name + "." + config.k8sMongoServiceName + "." + pod.metadata.namespace + ".svc." + clusterDomain;
  //   }
  // }

  var clusterDomain = config.k8sClusterDomain;
  if (config.external_domain) {
    return pod.metadata.name + "." + config.external_domain;
  } else if (!config.k8sMongoServiceName) {
    return pod.metadata.name + "." + pod.metadata.namespace + ".svc." + clusterDomain;
  } else {
    return pod.metadata.name + "." + config.k8sMongoServiceName + "." + pod.metadata.namespace + ".svc." + clusterDomain;
  }
};

var addrToRemoveLoop = function (members) {
  var addrToRemove = [];
  for (var i in members) {
    var member = members[i];
    if (memberShouldBeRemoved(member)) {
      addrToRemove.push(member.name);
    } else {
      if (config.external_domain && config.external_domain != "") {
        if (invalid_config && member.name.indexOf(config.external_domain) > -1) {
          log(member.name + " match " + config.external_domain + " but cofig is invalid, so we will try with local names first")
          addrToRemove.push(member.name);
        } else if (member.name.indexOf(config.external_domain) == -1 && member.stateStr != "ARBITER") {
          log(member.name + " does not match " + config.external_domain)
          addrToRemove.push(member.name);
        }
      } else {
        if (config.k8sMongoServiceName && member.name.indexOf("." + config.k8sMongoServiceName) == -1) {
          // if not arbiter 
          if (member.stateStr != "ARBITER") {
            log(member.name + " does not match " + config.k8sMongoServiceName)
            addrToRemove.push(member.name);
          }
        }
      }
    }
  }
  if (addrToRemove.length > 0 && members.length == 3) {
    for (var i in members) {
      if (member.stateStr == "ARBITER") {
        log("We are in PSA mode, but cannot have an PA setup ( then mongodb will refuse to readd new node(s)), refuse to remove " + JSON.stringify(addrToRemove))
        addrToRemove = [];
        break;
      }
    }
  }
  return addrToRemove;
};

var memberShouldBeRemoved = function (member) {
  if (!member.health) {
    var lastHeartbeat = member.lastHeartbeatRecv; // member.lastHeartbeatRecv
    if (lastHeartbeat) {
      const now = new Date();
      const lastHeartbeatRecv = new Date(lastHeartbeat);
      const seconds = (now.getTime() - lastHeartbeatRecv.getTime()) / 1000;
      if (seconds > config.unhealthySeconds) {
        var state = (member.laststate || member.stateStr) + " / " + member.lastHeartbeatMessage;
        log(member.name + " unhealthy for more than  " + config.unhealthySeconds + " seconds: " + state)
        return true;
      }
    }
  }
  return false;
};

var removeDeadMembers = function (rsConfig, addrsToRemove) {
  if (!addrsToRemove || !addrsToRemove.length) return;

  for (var i in addrsToRemove) {
    var addrToRemove = addrsToRemove[i];
    for (var j in rsConfig.members) {
      var member = rsConfig.members[j];
      if (member.host === addrToRemove) {
        rsConfig.members.splice(j, 1);
        break;
      }
    }
  }
};
var addNewMembers = function (rsConfig, pods, addrsToAdd) {
  if (!addrsToAdd || !addrsToAdd.length) return;

  var memberIds = [];
  var newMemberId = 0;

  // Build a list of existing rs member IDs
  for (var i in rsConfig.members) {
    memberIds.push(rsConfig.members[i]._id);
  }

  for (var i in addrsToAdd) {
    var addrToAdd = addrsToAdd[i];

    // Search for the next available member ID (max 255)
    for (var i = newMemberId; i <= 255; i++) {
      if (!memberIds.includes(i)) {
        newMemberId = i;
        memberIds.push(newMemberId);
        break;
      }
    }

    // Somehow we can get a race condition where the member config has been updated since we created the list of
    // addresses to add (addrsToAdd) ... so do another loop to make sure we're not adding duplicates
    var exists = false;
    for (var j in rsConfig.members) {
      var member = rsConfig.members[j];
      if (member.host === addrToAdd) {
        // log("Host [%s] already exists in the Replicaset. Not adding...", addrToAdd);
        exists = true;
        break;
      }
    }

    if (exists) {
      continue;
    }

    var cfg = {
      _id: newMemberId,
      host: addrToAdd
    };

    var labels = config.mongoArbiterLabelCollection;
    for (var i in pods) {
      var pod = pods[i];
      if (pod.addrToUse == addrToAdd) {
        if (podContainsLabels(pod, labels)) {
          cfg.arbiterOnly = true;
        }
      }
    }
    rsConfig.members.push(cfg);
  }
};

function int2ip(ipInt) {
  return ((ipInt >>> 24) + "." + (ipInt >> 16 & 255) + "." + (ipInt >> 8 & 255) + "." + (ipInt & 255));
}
function ip2int(ip) {
  return ip.split(".").reduce(function (ipInt, octet) { return (ipInt << 8) + parseInt(octet, 10) }, 0) >>> 0;
}
function podElection(pods) {
  //Because all the pods are going to be running this code independently, we need a way to consistently find the same
  //node to kick things off, the easiest way to do that is convert their ips into longs and find the highest

  var list = []
  var labels = config.mongoPodLabelCollection;
  for (var i in pods) {
    var pod = pods[i];
    if (podContainsLabels(pod, labels)) {
      list.push(pod);
    }
  }

  list.sort(function (a, b) {
    var aIpVal = ip2int(a.status.podIP);
    var bIpVal = ip2int(b.status.podIP);
    if (aIpVal < bIpVal) return -1;
    if (aIpVal > bIpVal) return 1;
    return 0; //Shouldn't get here... all pods should have different ips
  });

  //Are we the lucky one?
  return list[0].status.podIP == hostIp;
};

async function isInReplSet(ip) {
  if (config.skip_remote_check) return false;
  var cli = null;
  try {
    cli = await Connect(ip);
    var rsConfig = await replSetGetConfig(cli);
    return true;
  } catch (error) {
    console.error("isInReplSet error: " + (error.message ? error.message : error))
    return false;
  }
  finally {
    if (cli != null) cli.close(true);
  }
};




const generatePublicPrivatePairOfKeys = (cipher, passphrase) => {
  // The `generateKeyPairSync` method accepts two arguments:
  // 1. The type of keys we want, which in this case is "rsa"
  // 2. An object with the properties of the key
  return crypto.generateKeyPairSync("rsa", {
    // The standard secure default length for RSA keys is 2048 bits
    modulusLength: 4096,
    publicKeyEncoding: {
      type: "spki",
      format: "pem"
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
      cipher,
      passphrase
    },
  });
};
function generateCertificate(privateKey, publicKey, attrs, years, passphrase) {
  const forge = require("node-forge");
  const pki = forge.pki;
  var prKey = undefined;
  if (passphrase && passphrase != "") {
    prKey = forge.pki.decryptRsaPrivateKey(privateKey, passphrase);
  } else {
    prKey = forge.pki.privateKeyFromPem(privateKey);
  }
  const pubKey = pki.publicKeyFromPem(publicKey);

  // create a new certificate
  const cert = pki.createCertificate();

  // fill the required fields
  cert.publicKey = pubKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notBefore.setDate(
    cert.validity.notBefore.getDate() - 1
  );

  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(
    cert.validity.notBefore.getFullYear() + years
  );

  // here we set subject and issuer as the same one
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // openssl x509 -text -noout -in /home/allan/code/mongo-k8s-sidecar/tls/ca.pem | grep CA
  cert.setExtensions([
    {
      name: "basicConstraints",
      cA: true,
    }
  ]);


  // the actual certificate signing
  cert.sign(prKey, forge.md.sha256.create());

  // now convert the Forge certificate to PEM format
  return pki.certificateToPem(cert);
}


const attrs = [
  {
    name: "commonName",
    value: "rootCA.org",
  },
  {
    name: "countryName",
    value: "SY",
  },
  {
    shortName: "ST",
    value: "SYRIA",
  },
  {
    name: "localityName",
    value: "DAMAS",
  },
  {
    name: "organizationName",
    value: "DAMASCUS UNIVERSITY",
  },
  {
    shortName: "OU",
    value: "Testy",
  },
]

// Creating built-in CA store
const doGenerateCertificate = (path, cipher, passphrase) => {
  const fs = require("fs");
  fs.mkdirSync(path, { recursive: true });
  const _path = require('path');
  const privatepath = _path.join(path, "ca-private.pem");
  const publicpath = _path.join(path, "ca-public.pem");
  const capath = _path.join(path, "ca.pem");

  var Keys = { privateKey: null, publicKey: null }

  // if (fs.existsSync(privatepath) && fs.existsSync(publicpath)) {
  if (fs.existsSync(privatepath) ) {
    Keys.privateKey = fs.readFileSync(privatepath, { encoding: "utf-8" });
    if(fs.existsSync(publicpath)) {
      Keys.publicKey = fs.readFileSync(publicpath, { encoding: "utf-8" });
    }
  } else {
    Keys = generatePublicPrivatePairOfKeys(cipher, passphrase);
    fs.mkdirSync(path, { recursive: true });
    // Writing to files
    fs.writeFileSync(privatepath, Keys.privateKey, { encoding: "utf-8" });
    fs.writeFileSync(publicpath, Keys.publicKey, { encoding: "utf-8" });

  }
  if (fs.existsSync(capath)) {
    return fs.readFileSync(capath, { encoding: "utf-8" });
  } else {
    // Generate CA certificate
    const CA = generateCertificate(
      Keys.privateKey,
      Keys.publicKey,
      attrs,
      20,
      passphrase
    );
    // Writing to file
    fs.writeFileSync(capath, CA, {
      encoding: "utf-8",
    });
    return CA;
  }

}



const generateCSR = (privateKey, publicKey, passphrase) => {
  const forge = require("node-forge");
  const pki = forge.pki;

  var prKey = undefined;
  if (passphrase && passphrase != "") {
    prKey = forge.pki.decryptRsaPrivateKey(privateKey, passphrase);
  } else {
    prKey = forge.pki.privateKeyFromPem(privateKey);
  }
  const pubKey = pki.publicKeyFromPem(publicKey);

  // generate a key pair
  // const keys = forge.pki.rsa.generateKeyPair(1024);

  var cfghosts = config.tls_hosts.split(",");

  // create a certification request (CSR)
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = pubKey;
  csr.setSubject([
    {
      name: "commonName",
      value: cfghosts[0],
    },
    {
      name: "countryName",
      value: "US",
    },
    {
      shortName: "ST",
      value: "Virginia",
    },
    {
      name: "localityName",
      value: "Blacksburg",
    },
    {
      name: "organizationName",
      value: "Test",
    },
    {
      shortName: "OU",
      value: "Test",
    },
  ]);
  // set (optional) attributes
  var hosts = [];
  for (var i = 0; i < cfghosts.length; i++) {
    if (cfghosts[i] && cfghosts[i] != "") {
      hosts.push({ type: 2, value: cfghosts[i] });
    }
  }
  if (cfghosts.indexOf("localhost") == -1) hosts.push({ type: 2, value: "localhost" });
  if (cfghosts.indexOf("127.0.0.1") == -1) hosts.push({ type: 7, value: "127.0.0.1" });
  csr.setAttributes([
    // {
    //   name: "challengePassword",
    //   value: "password",
    // },
    {
      name: "unstructuredName",
      value: "My Company, Inc.",
    },
    {
      name: "extensionRequest",
      extensions: [
        {
          name: "subjectAltName",
          altNames: hosts,
        },
      ],
    },
  ]);

  // sign certification request
  csr.sign(prKey);

  // verify certification request
  const verified = csr.verify();

  // convert certification request to PEM-format
  const pem = forge.pki.certificationRequestToPem(csr);

  // convert a Forge certification request from PEM-format
  // const csr = forge.pki.certificationRequestFromPem(pem);

  // get an attribute
  // csr.getAttribute({ name: "challengePassword" });

  // get extensions array
  // csr.getAttribute({ name: "extensionRequest" }).extensions;

  return pem;
}

const verifiyCSR = (isca, csrPem, path, passphrase, years) => {
  const forge = require("node-forge");
  const fs = require("fs");
  const _path = require('path');
  const privatepath = _path.join(path, "ca-private.pem");
  const capath = _path.join(path, "ca.pem");


  const csr = forge.pki.certificationRequestFromPem(csrPem);

  // Read CA cert and key

  const caCertPem = fs.readFileSync(capath, { encoding: "utf-8" });
  const caKeyPem = fs.readFileSync(privatepath, { encoding: "utf-8" });
  const caCert = forge.pki.certificateFromPem(caCertPem);
  var caKey = undefined;
  if (passphrase && passphrase != "") {
    caKey = forge.pki.decryptRsaPrivateKey(caKeyPem, passphrase);
  } else {
    caKey = forge.pki.privateKeyFromPem(caKeyPem);
  }

  if (csr.verify()) {
    console.log("Certification request (CSR) verified.");
  } else {
    throw new Error("Signature not verified.");
  }

  console.log("Creating certificate...");
  const cert = forge.pki.createCertificate();
  cert.serialNumber = "02";

  cert.validity.notBefore = new Date();
  cert.validity.notBefore.setDate(
    cert.validity.notBefore.getDate() - 1
  );
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(
    cert.validity.notBefore.getFullYear() + years
  );



  var altNames = csr.attributes.find(t => t.name === 'extensionRequest').extensions.find(t => t.name === 'subjectAltName').altNames

  // subject from CSR
  cert.setSubject(csr.subject.attributes);
  // issuer from CA
  cert.setIssuer(caCert.subject.attributes);

  if(isca) {
    cert.setExtensions([
      {
        name: "basicConstraints",
        CA: true,
      }]); 
  } else {
    cert.setExtensions([
      {
        name: "keyUsage",
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true,
      },
      {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true,
        codeSigning: true,
        emailProtection: true,
        timeStamping: true
      },
      {
        name: 'nsCertType',
        client: true,
        server: true,
        email: true,
        objsign: true,
        sslCA: true,
        emailCA: true,
        objCA: true
      },
      {
        name: "subjectAltName",
        altNames
      },
    ]);
  }

  cert.publicKey = csr.publicKey;

  cert.sign(caKey, forge.md.sha256.create());
  console.log("Certificate created.");

  return forge.pki.certificateToPem(cert);
}


const createCSR = (privateKey, publicKey, years, passphrase, path) => {
  const fs = require("fs");
  const _path = require('path');
  const certpath = _path.join(path, "cert.pem");
  const pubcertpath = _path.join(path, "cert.cer");

  if (fs.existsSync(certpath)) {
    return fs.readFileSync(certpath, { encoding: "utf-8" });
  }

  // Initiating certificate signing request
  const CSR = generateCSR(privateKey, publicKey, passphrase);

  // verifying csr by certification authority and getting a CA certificate
  const cert = verifiyCSR(false, CSR, path, passphrase, years);


  // Writting CA certificate to a file, so we can use it a bit latter
  fs.writeFileSync(pubcertpath, cert, { encoding: "utf-8" });
  fs.writeFileSync(certpath, cert + privateKey, { encoding: "utf-8" });
  return cert;
};

const verifyCertificate = (certPem, path) => {
  const log = console.log;
  const pki = require("node-forge").pki;
  const fs = require("fs");
  const _path = require('path');
  const privatepath = _path.join(path, "ca-private.pem");
  const capath = _path.join(path, "ca.pem");

  let caCert;
  let caStore;

  try {
    caCert = fs.readFileSync(capath, { encoding: "utf-8" });

    caStore = pki.createCaStore([caCert]);
  } catch (e) {
    log("Failed to load CA certificate (" + e + ")");
    return false;
  }

  try {
    const certToVerify = pki.certificateFromPem(certPem);
    const verified = pki.verifyCertificateChain(caStore, [certToVerify]);
    if (verified) {
      log("Certificate got verified successfully.!");
    }
    return verified;
  } catch (e) {
    log("Failed to verify certificate (" + (e.message || e) + ")");
    return false;
  }
}
