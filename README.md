# mbed Cloud Edge JS

node.js protocol translator library to manage devices through mbed Cloud Edge.

Example usage:

* [Example application](example/buttons.js)
* [mbed Cloud Bluetooth Devicelink](https://github.com/ARMmbed/cloud-bluetooth-devicelink/tree/mbed-client-service).
* [LoRa bridge](https://github.com/ARMmbed/connector-loriot/tree/architectify).

## How to run the example application

1. Install [node.js](https://nodejs.org/en/) v8 or higher.
1. Clone this repository.
1. Install dependencies via:

    ```
    $ npm install
    ```

1. Start mbed Cloud Edge on port 9100 via:

    ```
    $ build/mcc-linux-x86/existing/bin/gw-server 9100 9101
    ```

1. Run the example application:

    ```
    $ node example/buttons.js
    ```
