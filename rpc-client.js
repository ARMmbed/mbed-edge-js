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

const promisify = require('es6-promisify');
const EventEmitter = require('events');
const fp = require('ieee-float');
const i64 = require('node-int64');

/**
 * RPCClient for Mbed Edge
 * @param {*} edgeRpc Instance of edge-rpc-client
 */
function RPCClient(edgeRpc, id) {
    EventEmitter.call(this);

    this.edgeRpc = edgeRpc;
    this.id = id;
    this.rpcId = id;
    this.is_open = () => edgeRpc.is_open();
    this.routes = {};

    this._onTerminateQueue = [];

    this.is_registered = false;
}

RPCClient.prototype = Object.create(EventEmitter.prototype);

/**
 * Open the RPC Channel
 * @return Returns a promise
 */
RPCClient.prototype.open = function() {
    return Promise.resolve();
};

RPCClient.prototype._setValue = function(route, newValue) {
    if (route.indexOf('/') === 0) route = route.substr(1); // should be fixed higher up

    if (!this.is_open) return Promise.reject('RPC Channel is closed');
    if (!this.routes[route]) return Promise.reject(`Unknown route '${route}'`);

    let r = this.routes[route];
    if (r.type === 'function') return Promise.reject('Route type is function, cannot set value');

    r.value = newValue;

    return this.edgeRpc.sendJsonRpc('write', {
        'deviceId': this.rpcId,
        'objects': this._getObjectModel()
    });
};

RPCClient.prototype._createResource = function(type, route, value, opr, observable, callback) {
    let self = this;

    if (!this.is_open()) return Promise.reject('RPC Channel is closed');
    if (!/^(\d)+\/\d\/(\d+)$/.test(route)) return Promise.reject('route should be of format "3200/0/5501"');
    if (typeof value === 'undefined') return Promise.reject('value is required');

    if (typeof opr === 'function') {
        callback = opr;
        opr = undefined;
    }
    else if (typeof observable === 'function') {
        callback = observable;
        observable = undefined;
    }

    if (typeof opr === 'undefined') opr = RPCClient.GET_PUT_ALLOWED;
    if (typeof observable === 'undefined') observable = true;

    let o = this.routes[route] = {
        type: type,
        value: value,
        opr: opr,
        observable: observable,
        callback: callback,
        setValue: newValue => {
            return this._setValue(route, newValue);
        }
    };

    var onUpdated = (deviceId, r_route, newValue) => {
        if (deviceId !== this.id) return;
        if (route !== r_route) return;

        if (type === 'int') {
            let value = new i64(newValue) + 0;

            o.value = value;
        }
        else if (type === 'float') {
            let value = fp.readDoubleBE(newValue);

            o.value = value;
        }
        else {
            o.value = newValue.toString('utf-8');
        }
    };

    this.edgeRpc.on('resource-updated', onUpdated);

    this._onTerminateQueue.push(() => {
        this.edgeRpc.removeListener('resource-updated', onUpdated);
    })

    // actual adding happens in register call
    return Promise.resolve(o);
};

RPCClient.prototype.createResourceString = function(route, value, opr, observable, callback) {
    return this._createResource('string', route, value, opr, observable, callback);
};

RPCClient.prototype.createResourceInt = function(route, value, opr, observable, callback) {
    return this._createResource('int', route, value, opr, observable, callback);
};

RPCClient.prototype.createResourceFloat = function(route, value, opr, observable, callback) {
    return this._createResource('float', route, value, opr, observable, callback);
};

RPCClient.prototype.createFunction = function(route, callback) {
    if (!this.is_open()) return Promise.reject('RPC Channel is closed');
    if (!/^(\d)+\/\d\/(\d+)$/.test(route)) return Promise.reject('route should be of format "3200/0/5501"');

    this.routes[route] = {
        type: 'function',
        opr: RPCClient.POST_ALLOWED,
        get route() {
            return route;
        },
        callback: callback
    };

    var onExecuted = (deviceId, r_route, buff) => {
        if (deviceId !== this.id) return;
        if (route !== r_route) return;

        if (callback) {
            callback(buff);
        }
    };

    this.edgeRpc.on('resource-executed', onExecuted);

    this._onTerminateQueue.push(() => {
        this.edgeRpc.removeListener('resource-executed', onExecuted);
    });

    // actual adding happens in register call
    return Promise.resolve();
};

RPCClient.prototype._getObjectModel = function() {
    let objs = [];

    for (let route of Object.keys(this.routes)) {
        // Mbed Edge only supports numbers...
        let [objId, objInstId, resId] = route.split('/').map(Number);

        let obj = objs.find(o => o['objectId'] === objId);
        if (!obj) {
            obj = { 'objectId': objId, 'objectInstances': [] };
            objs.push(obj);
        }

        let objInst = obj['objectInstances'].find(o => o['objectInstanceId'] === objInstId);
        if (!objInst) {
            objInst = { 'objectInstanceId': objInstId, 'resources': [] };
            obj['objectInstances'].push(objInst);
        }

        let valueBuffer;

        let r = this.routes[route];

        switch (r.type) {
            case 'string':
                valueBuffer = new Buffer((r.value || '').toString(), 'utf-8');
                break;

            case 'float':
                if (typeof r.value !== 'number') r.value = Number(r.value);

                valueBuffer = Buffer.alloc(4);
                valueBuffer.writeFloatBE(r.value);
                break;

            case 'int':
                if (typeof r.value !== 'number') r.value = Number(r.value);

                valueBuffer = Buffer.alloc(4);
                valueBuffer.writeInt32BE(r.value);
                break;

            case 'function':
                valueBuffer = new Buffer('', 'utf-8');
                break;

            default:
                console.warn('Undefined type for route', route, r.type);
                valueBuffer = new Buffer('', 'utf-8');
                break;
        }

        objInst.resources.push({
            'resourceId': resId,
            'operations': this.routes[route].opr,
            'type': this.routes[route].type === 'function' ? 'opaque' : this.routes[route].type,
            'value': valueBuffer.toString('base64')
        });
    }

    return objs;
}

RPCClient.prototype.register = async function() {
    let registrationResponse = await this.edgeRpc.sendJsonRpc('device_register', {
        'deviceId': this.rpcId,
        'objects': this._getObjectModel()
    });

    this.is_registered = true;

    // FIXME: should return the real endpoint... this is a workaround
    return this.rpcId;
};

RPCClient.prototype.unregister = async function() {
    if (!this.is_registered) return true;

    await this.edgeRpc.sendJsonRpc('device_unregister', {
        'deviceId': this.rpcId,
    });

    this.is_registered = false;
};

RPCClient.prototype.terminate = function() {
    clearInterval(this._getQueueIv);

    for (let fn of this._onTerminateQueue) {
        fn();
    }

    return Promise.resolve();
}

RPCClient.NOT_ALLOWED                 = 0x00;
RPCClient.GET_ALLOWED                 = 0x01;
RPCClient.PUT_ALLOWED                 = 0x02;
RPCClient.GET_PUT_ALLOWED             = 0x03;
RPCClient.POST_ALLOWED                = 0x04;
RPCClient.GET_POST_ALLOWED            = 0x05;
RPCClient.PUT_POST_ALLOWED            = 0x06;
RPCClient.GET_PUT_POST_ALLOWED        = 0x07;
RPCClient.DELETE_ALLOWED              = 0x08;
RPCClient.GET_DELETE_ALLOWED          = 0x09;
RPCClient.PUT_DELETE_ALLOWED          = 0x0A;
RPCClient.GET_PUT_DELETE_ALLOWED      = 0x0B;
RPCClient.POST_DELETE_ALLOWED         = 0x0C;
RPCClient.GET_POST_DELETE_ALLOWED     = 0x0D;
RPCClient.PUT_POST_DELETE_ALLOWED     = 0x0E;
RPCClient.GET_PUT_POST_DELETE_ALLOWED = 0x0F;

module.exports = RPCClient;
