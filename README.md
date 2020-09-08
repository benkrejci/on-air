# What is this?

I built a pair of "on air" lights so that my partner and I can signal to each other when not to be interrupted.
This solves the problem of one of us (mostly me) barging in on the other while they are in the middle of a work call, zoom meeting etc.

Each box will discover any other boxes on the network and communicate automatically with each other to reach consensus about shared "status".

By default, status can be "off", "low", or "high", which are to "green", "yellow", and "red" respectively.
This can, however, be configured to support different use cases and hardware configurations.

# Hardware

This project requires some knowledge of driving LEDs from a Raspberry PI or other digital IO. I will describe my setup here.

## My build

### Components

- 1W RGB LED chip assembled by Adafruit
- Mosfet

# Installation

### Install Node

On a recent PI (2+) nvm should work just fine:
```sh
sudo apt-get install -y nvm 
nvm install 12 --lts
```

On a 1st gen Pi, this worked for me:
```sh
wget https://unofficial-builds.nodejs.org/download/release/v12.18.3/node-v12.18.3-linux-armv6l.tar.gz
tar -xzf node-v12.18.3-linux-armv6l.tar.gz
sudo cp -R node-v12.18.3-linux-armv6l/* /usr/local
```

### Install other dependencies

```sh
npm i -g yarn # you may have to use sudo if you didn't install node via nvm
yarn global add typescript
```

### Clone on-air and install dependencies

```sh
git clone https://github.com/benkrejci/on-air.git
cd on-air
./bin/install
```

### Note

The above install script sets up a systemd service, which will work on modern versions of Raspbian (as well as most Linux distros).
If this doesn't work, you need to manually set up an init script so that dist/index.js runs on startup. See [bin/.installService](./bin/installService) for reference.

## Configure

The default configuration can be found in [config/box-config.default.yml](config/config.default.yml).
The install script copies this file to config/box-config.yml so feel free to change it to suit the specific hardware configuration you are using. See [RawConfig interface](lib/config.ts#L3) for available configuration options.