# Mbed Edge.js

Node.js protocol translator library to manage devices through Mbed Edge. Tested against Mbed Edge v0.5.1.

Example usage:

* [Example application](example/buttons.js)
* [Mbed Cloud Bluetooth Devicelink](https://github.com/ARMmbed/cloud-bluetooth-devicelink/tree/mbed-client-service).
* [LoRa bridge](https://github.com/ARMmbed/cloud-lora-devicelink) (internal to Arm).

## How to run the example application

1. Install [Mbed Edge](https://github.com/armmbed/mbed-edge).
1. Install [Node.js](https://nodejs.org/en/) v8 or higher.
1. Clone this repository.
1. Install dependencies via:

    ```
    $ npm install
    ```

1. Start Mbed Edge via:

    ```
    $ build/bin/edge-core -o 9101
    ```

1. Run the example application:

    ```
    $ node example/buttons.js
    ```

## Running in a VM

Mbed Edge only runs on Linux, but it's useful to run the protocol translator from your host OS. To do this, use `socat` to forward events from the Edge socket to a TCP socket. On your VM run:

```
$ socat TCP-LISTEN:22223,reuseaddr,fork UNIX-CLIENT:/tmp/edge.sock
```

Then, call Mbed Edge.js via:

```
const Edge = require('mbed-edge-js');

let edge = new Edge('ws://YOUR_VM_IP:22223', 'your_protocol_translator');
```
