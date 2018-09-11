/**
 * This example shows how you can use Mbed Cloud Edge to create multiple devices, set resources, and subscribe to resource updates
 */

const Edge = require('../');

(async function() {
    let edge;
    try {
        // make sure to deinit() when quit'ing this process
        let quitImmediately = false;
        let sigintHandler;
        process.on('SIGINT', sigintHandler = async function() {
            if (quitImmediately) process.exit(1);

            try {
                await edge.deinit();
            } catch (ex) {}
            process.exit(1);
        });

        edge = new Edge('ws+unix:///tmp/edge.sock:', 'example-buttons');     // <-- when running Edge on the same machine
        // edge = new Edge('ws://192.168.122.132:22223', 'example-buttons');    // <-- when running Edge in a VM, see README.md
        await edge.init();

        console.log('Connected to Mbed Cloud Edge');

        // create two new devices
        let device1 = await edge.createCloudDevice('button-device1', 'clicky');
        let device2 = await edge.createCloudDevice('button-device2', 'clicky');

        console.log('Created devices');

        // devices can emit put/post/fota events
        device1.on('put', (route, newValue) => {
            console.log('device1 PUT came in', route, newValue);
        });

        device2.on('post', (route, newValue) => {
            console.log('device2 POST came in', route, newValue.toString('utf-8'));
        });

        // register the devices
        await device1.register([
            {
                path: '/3321/0/5501',
                operation: ['GET', 'PUT'],
                value: 1
            }
        ], false /* supports update */);

        await device2.register([
            {
                path: '/4001/0/5901',
                operation: ['GET', 'PUT'],
                value: 100
            },
            {
                path: '/4001/0/5902',
                operation: ['POST']
            },
        ], false /* supports update */);

        console.log('Devices registered');

        // now when someone presses a button, we can up the resources
        console.log('Press either `1` to update device1, or `2` to update device2 (or CTRL+C to quit)');

        let stdin = process.stdin;
        stdin.setRawMode( true );
        stdin.resume();
        stdin.setEncoding('utf8');

        stdin.on('data', async function(key) {
            // CTRL-C should kill the process (first cleanup of course)
            if (key === '\u0003') {
                return sigintHandler();
            }

            if (key === '1') {
                let r1 = device1.resources['/3321/0/5501'];
                await r1.setValue(Number(r1.value) + 1);
                console.log('Set value for device1 to', r1.value);
            }
            else if (key === '2') {
                let r2 = device2.resources['/4001/0/5901'];
                await r2.setValue(Number(r2.value) + 1);
                console.log('Set value for device2 to', r2.value);
            }
            else {
                process.stdout.write(key);
            }
        });

    }
    catch (ex) {
        console.error('Error...', ex);

        await edge.deinit();
    }
})();
