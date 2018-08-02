/*
 * ----------------------------------------------------------------------------
 * Copyright 2018 ARM Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ----------------------------------------------------------------------------
 */

const EventEmitter = require('events');
const promisify = require('es6-promisify');
const JsonRpcWs = require('json-rpc-ws');
const util = require('util');

const CON_PR = '\x1b[34m[ClientService]\x1b[0m';

function wait(ms) {
    return new Promise((res, rej) => setTimeout(res, ms));
}

function EdgeRpcClient(socketPath, name) {
    EventEmitter.call(this);

    this.socketPath = socketPath;
    this.apiPath = '/1/pt';
    this.name = name;

    this._is_open = false;

    this.client = JsonRpcWs.createClient();
}

EdgeRpcClient.prototype = Object.create(EventEmitter.prototype);

EdgeRpcClient.prototype.is_open = function() {
    return this._is_open;
};

EdgeRpcClient.prototype.sendJsonRpc = async function(method, params) {
    return new Promise((resolve, reject) => {
        let timeout = setTimeout(() => {
            reject('Timeout');
        }, 10000);

        this.client.send(method, params, (err, response) => {
            clearTimeout(timeout);

            if (err) return reject(err);

            resolve(response);
        });
    });
}

EdgeRpcClient.prototype._onData = async function(params, response) {
    let value = Buffer.from(params.value, 'base64');
    let route = params.uri.objectId + '/' + params.uri.objectInstanceId
        + '/' + params.uri.resourceId;
    let deviceId = params.uri.deviceId;

    if (params.operation === 2) {
        this.emit('resource-updated', deviceId, route, value);
    }
    else if (params.operation === 4) {
        this.emit('resource-executed', deviceId, route, value);
    }
    else {
        console.log(CON_PR, 'Unknown "write" operation', params);
    }

    response(null, 'ok');
};

EdgeRpcClient.prototype.init = async function(tryIx) {
    tryIx = tryIx || 0;

    try {
        let url = util.format('ws+unix://%s:%s',
                              this.socketPath,
                              this.apiPath);
        console.log(CON_PR, 'Connecting to Mbed Edge on ' + url, `(try: ${++tryIx})`);
        await this.connect();
    }
    catch (ex) {
        if (ex.code !== 'ECONNREFUSED') {
            console.log(CON_PR, 'Failed to connect to Mbed Edge, but not ECONNREFUSED...', ex);
        }

        // try again in a second
        await wait(1000);
        return this.init(tryIx);
    }

    this.client.expose('write', this._onData.bind(this));

    console.log(CON_PR, 'Connected to Mbed Edge');

    // ok... so let's see what we can do now
    console.log(CON_PR, 'Registering protocol translator', this.name);
    await this.sendJsonRpc('protocol_translator_register', { name: this.name });

    this._is_open = true;

    console.log(CON_PR, 'Mbed Edge initialized');
};

EdgeRpcClient.prototype.connect = function() {
    return new Promise((resolve, reject) => {
        let url = util.format('ws+unix://%s:%s',
                              this.socketPath,
                              this.apiPath);
        this.client.connect(url, (err, reply) => {
            if (err) return reject(err);

            resolve();
        });
    });
};

EdgeRpcClient.prototype.deinit = async function() {
    return new Promise((resolve, reject) => {
        this.client.disconnect((err, response) => {
            if (err) return reject(err);

            resolve(response);
        });
    });
};

EdgeRpcClient.prototype.wait = async function(ms) {
    return new Promise((res, rej) => {
        setTimeout(res, ms);
    });
};

module.exports = EdgeRpcClient;
