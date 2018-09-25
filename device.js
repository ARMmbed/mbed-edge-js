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
const url = require('url');
const RPCClient = require('./rpc-client');
const manifestParser = require('./manifest-parser');
const fs = require('fs');
const fp = require('ieee-float');
const i64 = require('node-int64');
const Path = require('path');

const CON_PR = '\x1b[34m[ClientService]\x1b[0m';

const ARM_UC_MONITOR_STATE_NONE              = 0;
const ARM_UC_MONITOR_STATE_DOWNLOADING       = 1;
const ARM_UC_MONITOR_STATE_DOWNLOADED        = 2;
const ARM_UC_MONITOR_STATE_UPDATING          = 3;

const ARM_UC_MONITOR_RESULT_NONE             = 0;
const ARM_UC_MONITOR_RESULT_SUCCESS          = 1;
const ARM_UC_MONITOR_RESULT_ERROR_STORAGE    = 2;
const ARM_UC_MONITOR_RESULT_ERROR_MEMORY     = 3;
const ARM_UC_MONITOR_RESULT_ERROR_CONNECTION = 4;
const ARM_UC_MONITOR_RESULT_ERROR_CRC        = 5;
const ARM_UC_MONITOR_RESULT_ERROR_TYPE       = 6;
const ARM_UC_MONITOR_RESULT_ERROR_URI        = 7;
const ARM_UC_MONITOR_RESULT_ERROR_UPDATE     = 8;

function MbedDevice(id, clientType, edgeRpc) {
    // inherit from eventemitter
    EventEmitter.call(this);

    // immutable properties
    Object.defineProperty(this, 'id', { get: () => id });

    this.clientType = clientType;
    this.endpoint = '';

    this.edgeRpc = edgeRpc;

    this.ID_PR = '[' + this.id + ']';

    this.$setResources([]); // resources are set in register() call

    var onUpdated = (deviceId, path, newValue) => {
        path = '/' + path;

        if (deviceId !== this.id) return;

        if (this.resources[path]) {
            if (this.resources[path].rpcType === 'Int') {
                let value = new i64(newValue) + 0;

                this.resources[path].value = value;
            }
            else if (this.resources[path].rpcType === 'Float') {
                let value = fp.readDoubleBE(newValue);

                this.resources[path].value = value;
            }
            else {
                this.resources[path].value = newValue.toString('utf-8');
            }

            this.emit('put', path, this.resources[path].value);
        }
    };

    edgeRpc.on('resource-updated', onUpdated);
}

 [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61]

MbedDevice.prototype = Object.create(EventEmitter.prototype);

MbedDevice.prototype.$setResources = function(resources) {
    let self = this;

    // resources is an object with path as keys
    this.resources = resources.reduce((curr, res) => {
        curr[res.path] = res;

        // writeable resource? add a setValue call
        if (res.operation.indexOf('GET') > -1) {
            curr[res.path].setValue = function(v) {
                return self.setValue(res.path, v);
            }
        }

        return curr;
    }, {});
};

MbedDevice.prototype.setValue = async function(path, value) {
    try {
        if (this.rpcClient && this.rpcClient.is_open) {
            await this.rpcClient._setValue(path, value);
        }

        // update value when request succeeded
        this.resources[path].value = value;

        return value;
    }
    catch (ex) {
        // don't update the value
        throw ex;
    }
};

MbedDevice.prototype.deregister = async function() {
    const ID_PR = this.ID_PR;

    if (this.rpcClient && this.rpcClient.is_open) {
        console.log(CON_PR, ID_PR, 'Deregistering');
        try {
            await this.rpcClient.unregister();
        }
        catch (ex) {
            console.log(CON_PR, ID_PR, 'Deregistering failed', ex);
        }
        this.rpcClient.terminate();
    }

    this.endpoint = '';
};

MbedDevice.prototype.registerUpdateResources = async function(vendorId, classId, certificateBuffer) {
    const ID_PR = this.ID_PR;

    let rpc = this.rpcClient;

    // update resources
    await rpc.createFunction('5/0/1', url => {
        console.log(CON_PR, ID_PR, '5/0/1 Package URL call', url);
    });

    await rpc.createFunction('5/0/2', () => {
        console.log(CON_PR, ID_PR, '5/0/2 Execute firmware update call');
    });

    // Device metadata => Manifest protocol supported
    await rpc.createResourceInt('10255/0/0', 1, RPCClient.GET_ALLOWED, true);

    let fwState = this.fwState = await rpc.createResourceInt('5/0/3', ARM_UC_MONITOR_STATE_NONE, RPCClient.GET_ALLOWED, true);
    let fwResult = this.fwResult = await rpc.createResourceInt('5/0/5', ARM_UC_MONITOR_RESULT_NONE, RPCClient.GET_ALLOWED, true);
    let fwName = this.fwName = await rpc.createResourceString('5/0/6', '', RPCClient.GET_ALLOWED, true); // sha256 hash of the fw
    let fwVersion = this.fwVersion = await rpc.createResourceString('5/0/7', '', RPCClient.GET_ALLOWED, true); // timestamp from manifest

    await rpc.createFunction('5/0/0', async function (package) {
        try {
            console.log(CON_PR, ID_PR, '5/0/0 Firmware manifest was received');

            // reset the state of the resources
            await fwState.setValue(ARM_UC_MONITOR_STATE_NONE);
            await fwResult.setValue(ARM_UC_MONITOR_RESULT_NONE);
            await fwName.setValue('');
            await fwVersion.setValue('');

            // parse and verify manifest
            let manifest;
            try {
                // @todo: these should move to the definition file...
                manifest = this.manifest = await manifestParser.parseAndVerifyManifest(
                    vendorId,
                    classId,
                    certificateBuffer,
                    package
                );
            }
            catch (ex) {
                await fwState.setValue(ARM_UC_MONITOR_STATE_NONE);
                await fwResult.setValue(ARM_UC_MONITOR_RESULT_ERROR_UPDATE);
                throw ex;
            }
            console.log(CON_PR, ID_PR, 'manifest', manifest);

            await fwState.setValue(ARM_UC_MONITOR_STATE_DOWNLOADING);
            console.log(CON_PR, ID_PR, 'State is now', 'ARM_UC_MONITOR_STATE_DOWNLOADING');

            // download the firmware
            let firmware;
            try {
                firmware = await manifestParser.downloadAndVerifyFirmware(manifest);
            }
            catch (ex) {
                await fwState.setValue(ARM_UC_MONITOR_STATE_NONE);
                await fwResult.setValue(ARM_UC_MONITOR_RESULT_ERROR_URI);
                throw ex;
            }
            console.log(CON_PR, ID_PR, 'Firmware size is', firmware.length, 'bytes');

            await fwState.setValue(ARM_UC_MONITOR_STATE_DOWNLOADED);
            console.log(CON_PR, ID_PR, 'State is now', 'ARM_UC_MONITOR_STATE_DOWNLOADED');

            this.emit('fota', firmware /* buffer */);
        }
        catch (ex) {
            console.error('Downloading firmware failed...', ex);
        }
    }.bind(this));
};

MbedDevice.prototype.setFotaUpdating = async function () {
    await this.fwState.setValue(ARM_UC_MONITOR_STATE_UPDATING);

    console.log(CON_PR, this.ID_PR, 'Result is now', ARM_UC_MONITOR_STATE_UPDATING);
};

MbedDevice.prototype.setFotaError = async function (error) {
    await this.fwState.setValue(ARM_UC_MONITOR_STATE_NONE);
    await this.fwResult.setValue(ARM_UC_MONITOR_RESULT_ERROR_UPDATE);

    console.log(CON_PR, this.ID_PR, 'Result is now', ARM_UC_MONITOR_RESULT_ERROR_UPDATE);
};

MbedDevice.prototype.setFotaComplete = async function () {
    await this.fwResult.setValue(ARM_UC_MONITOR_RESULT_SUCCESS);
    console.log(CON_PR, this.ID_PR, 'Result is now', 'ARM_UC_MONITOR_RESULT_SUCCESS');

    await this.fwName.setValue(this.manifest.payload.reference.hash);
    await this.fwVersion.setValue(this.manifest.timestamp.toString());
    console.log(CON_PR, this.ID_PR, 'Set fwName and fwVersion');

    await this.fwState.setValue(ARM_UC_MONITOR_STATE_NONE);
    console.log(CON_PR, this.ID_PR, 'State is now', 'ARM_UC_MONITOR_STATE_NONE');
};

MbedDevice.prototype.register = async function(lwm2m, supportsUpdate, vendorId, classId, updateCertificateBuffer) {

    let rpc;

    const ID_PR = this.ID_PR;

    try {
        // set resource model
        this.$setResources(lwm2m);

        // console.log(CON_PR, ID_PR, 'Registering with model', lwm2m, 'supporting update', supportsUpdate);

        // then start an RPC channel
        let rpc = this.rpcClient = new RPCClient(this.edgeRpc, this.id);
        await rpc.open();

        console.log(CON_PR, ID_PR, 'Opened RPC Channel');

        this.edgeRpc.on('resource-executed', (deviceId, route, data) => {
            if (deviceId !== this.id) return;

            this.emit('post', '/' + route, data);
        });

        /*
            { path: '/example/0/rule', value: 'Hello world', valueType: 'dynamic', operation: ['GET', 'PUT'], observable: true }
        */
        let actions = lwm2m.map(l => {
            let path = l.path.replace(/^\//, '');

            if (l.operation.indexOf('POST') > -1) {
                return rpc.createFunction(path);
            }

            let type;
            if (typeof l.value === 'string' || isNaN(l.value)) {
                type = 'String';
            }
            else {
                if (l.value % 1 === 0) {
                    type = 'Int';
                }
                else {
                    type = 'Float';
                }
            }

            // add this info for the device as well
            l.rpcType = type;

            let isGet = l.operation.indexOf('GET') > -1;
            let isPut = l.operation.indexOf('PUT') > -1;
            let opr = RPCClient.NOT_ALLOWED;
            if (isGet && isPut) {
                opr = RPCClient.GET_PUT_ALLOWED;
            }
            else if (isGet) {
                opr = RPCClient.GET_ALLOWED;
            }
            else if (isPut) {
                opr = RPCClient.PUT_ALLOWED;
            }

            return rpc['createResource' + type](path, l.value, opr, l.observable);
        });

        // console.log(CON_PR, ID_PR, 'Setting resources');
        await Promise.all(actions);
        if (supportsUpdate) {
            await this.registerUpdateResources(vendorId, classId, updateCertificateBuffer);
        }
        console.log(CON_PR, ID_PR, 'Setting resources OK');

        console.log(CON_PR, this.ID_PR, 'Registering');
        this.endpoint = await rpc.register();
        console.log(CON_PR, this.ID_PR, 'Registered with endpoint', this.endpoint);
    }
    catch (ex) {
        console.error(CON_PR, ID_PR, 'Registering device failed', ex);

        if (rpc && rpc.is_open) {
            try {
                await rpc.unregister();
                console.log(CON_PR, ID_PR, 'Unregistered');
            }
            catch (ex) { console.log(CON_PR, ID_PR, 'Unregister failed', ex); }
            rpc.terminate();
            console.log(CON_PR, ID_PR, 'Terminated');
        }

        delete this.rpcClient;

        throw 'Registration failed ' + ex;
    }

    return this.endpoint;
};

MbedDevice.prototype.getRegistrationStatus = function() {
    if (this.rpcClient && this.rpcClient.is_registered) {
        return true;
    }
    return false;
};

module.exports = MbedDevice;
