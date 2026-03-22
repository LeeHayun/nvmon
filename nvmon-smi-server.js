/* Copyright (c) 2018-2021 Gyeonghwan Hong. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const smi = require('node-nvidia-smi');
const http = require('http');
const child_process = require('child_process');
const os = require('os');
const config = require('./nvmon-config.js');
const port = config.port; /* nvmon-smi-server port */

// Get My IP Address
let hostname;
{
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function(ifname) {
    ifaces[ifname].forEach(function(iface) {
      if (iface.family !== 'IPv4' || iface.internal) return;
      const ip = iface.address;
      console.log('interface : ' + ifname + ' / ' + ip);
      // /g 플래그 regex는 lastIndex를 유지하므로 매 인터페이스마다 새로 생성
      const ifnameRE = new RegExp(config.ifnameFilter);
      const ipRE = new RegExp(config.ipFilter);
      if (os.type().startsWith('Windows') ||
          (ifnameRE.exec(ifname) !== null && ipRE.exec(ip) !== null)) {
        hostname = ip;
      }
    });
  });
}
if (hostname === undefined) {
  console.log('[Error] Cannot get my IP address');
  process.exit(1);
}

function add_username(smiObj, pidListRaw) {
  const gpus = Array.isArray(smiObj.nvidia_smi_log.gpu)
    ? smiObj.nvidia_smi_log.gpu
    : [smiObj.nvidia_smi_log.gpu];

  const pidToUsername = {};
  for (const line of pidListRaw.split('\n')) {
    const toks = line.trim().split(/\s+/);
    const pid = parseInt(toks[0]);
    if (isNaN(pid)) continue;
    pidToUsername[pid] = toks[1];
  }

  for (const gpu of gpus) {
    if (typeof gpu.processes !== 'object' ||
        typeof gpu.processes.process_info !== 'object') continue;
    const procInfos = Array.isArray(gpu.processes.process_info)
      ? gpu.processes.process_info
      : [gpu.processes.process_info];
    for (const proc of procInfos) {
      proc.username = pidToUsername[proc.pid] || 'Unknown';
    }
  }
  return smiObj;
}

// Set Server
const server = http.createServer((_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (_req.method !== 'GET') {
    res.statusCode = 405;
    res.end();
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');

  try {
    smi((err, data) => {
      if (err) {
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }
      child_process.exec('ps -eo pid,user', (psErr, stdout) => {
        if (!psErr) {
          data = add_username(data, stdout);
        }
        res.end(JSON.stringify(data));
      });
    });
  } catch (e) {
    res.end(JSON.stringify({ error: String(e) }));
  }
});

// Start Server
server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
