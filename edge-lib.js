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

const fs = require('fs');
const MbedDevice = require('./device');
const EdgeRpc = require('./edge-rpc-client');

const CON_PR = '\x1b[34m[ClientService]\x1b[0m';

function RemoteClientService(url, name) {
    this.edgeRpc = new EdgeRpc(url, name);

    this.devices = [];
}

RemoteClientService.prototype.init = async function() {
    return this.edgeRpc.init();
};

RemoteClientService.prototype.deinit = async function() {
    await Promise.all(this.devices.map(d => d.deregister()));
    return this.edgeRpc.deinit();
};

/**
 * List all devices registered in the bridge.
 * Returns an array of IDs.
 */
RemoteClientService.prototype.listDevices = async function() {
    return Promise.resolve(this.devices.map(d => d.id));
};

/**
 * Get all devices that are cached in the bridge and are registered with Mbed Cloud
 */
RemoteClientService.prototype.getAllRegisteredDevices = function() {
    return this.devices.filter(d => d.getRegistrationStatus());
};

RemoteClientService.prototype.getEndpointForId = function(id) {
    let d = this.devices.find(d => d.id);
    if (!d) return null;

    return d.endpoint; // only returns something when registered though
};

/**
 * Gets the device from the bridge (or from cache if already loaded).
 * Returns an MbedDevice object.
 */
RemoteClientService.prototype.getDevice = async function(id, clientType) {
    let device = this.devices.filter(d => d.id === id)[0];

    if (!device) {
        return this.createCloudDevice(id, clientType);
    }
    return device;
};

RemoteClientService.prototype.createCloudDevice = async function(id, clientType) {
    let sshClient, rpcClient;

    const ID_PR = '[' + id + ']';

    try {
        let device = new MbedDevice(id, clientType, this.edgeRpc);

        this.devices.push(device);

        return device;
    }
    catch (ex) {
        // creating device failed...
        await this.deleteDevice(id);
        throw ex;
    }
};

RemoteClientService.prototype.deleteDevice = async function(id) {
    let device = this.devices.find(d => d.id === id);
    if (device) {
        await device.deregister();
    }

    let cacheIx = this.devices.findIndex(d => d.id === id);
    if (cacheIx > -1) {
        this.devices.splice(cacheIx, 1);
    }
};

module.exports = RemoteClientService;
