# Mbed Edge.js

Node.js protocol translator library to manage devices through Mbed Edge. Tested against Mbed Edge v0.5.1.

Example usage:

* [Example application](example/buttons.js)
* [Mbed Cloud Bluetooth Devicelink](https://github.com/ARMmbed/cloud-bluetooth-devicelink/tree/mbed-client-service).
* [LoRa bridge](https://github.com/ARMmbed/cloud-lora-devicelink).

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
