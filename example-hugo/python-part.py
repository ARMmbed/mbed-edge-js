import socket
import time
sock = socket.socket()

sock.connect(('127.0.0.1', 1337))

count = 0

while (True):
    count += 1
    sock.send(str(count))
    time.sleep(1)
