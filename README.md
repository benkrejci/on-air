# What is this?

I built a pair of "on air" lights so that my partner and I can signal to each other when not to be interrupted.
This solves the problem of one of us (mostly me) barging in on the other while they are in the middle of a work call, zoom meeting etc.

This project ended up being a pretty good learning experience for me around circuits and specifically driving high-power LEDs. It's a good overlap of a simple idea with myriad considerations and edge cases. 

Each box will discover any other boxes on the network via bonjour (zerconf, avahi) and communicate automatically with each other to reach consensus about shared "status".

By default, status can be "off", "low", or "high", which are to "off", "yellow", and "red" respectively.
This can, however, be configured to support different use cases and hardware configurations. Theoretically, if you hooked up the blue LED in the RGB diode, you could use any rgb color and as many statuses as you want!

# Installation

### Install Node

On a recent PI (2+) nvm should work just fine:
```sh
sudo apt install -y nvm
nvm install 12 --lts
```

On a 1st gen Pi or Pi Zero W (which is what I ultimately used mine), this worked for me:
```sh
wget https://unofficial-builds.nodejs.org/download/release/v12.18.3/node-v12.18.3-linux-armv6l.tar.gz
tar -xzf node-v12.18.3-linux-armv6l.tar.gz
sudo cp -R node-v12.18.3-linux-armv6l/* /usr/local
```

### Install other dependencies

```sh
sudo apt install git
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

# Hardware

This project requires some knowledge of driving LEDs from a Raspberry PI or other digital IO. I will describe my setup here.

## My build

This is best build I currently have. I use darlington transistors to switch the high power LED circuits from the 3.3v logic level out from Pi and constant current drivers for each of red and green led circuits.

### Components (for 1 box)

- Raspberry Pi Zero W
- 3W RGB LED chip [$2.95 on Adafruit](https://www.adafruit.com/product/2530)
- 2x darlington transistors (TIP120) [10 for $7 on Amazon](https://www.amazon.com/gp/product/B083TQN12B)
- 2x voltage regulator (LM317T) [25 for $8 on Amazon](https://www.amazon.com/gp/product/B07VNNHWF9)
- *Optional* heatsink for at least the red LM317 [12 for $6 on Amazon](https://www.amazon.com/Insulator-Rubberized-Regulator-Transistor-20mmx15mmx11mm/dp/B07PGVZ7CJ) 
- Resistors (1/4W)
  - 2x 1kΩ
  - 5x 20Ω
  - 2x 15Ω
- Buck converter (for powering Pi from 9v source) [6 for $10 on Amazon](https://www.amazon.com/gp/product/B076H3XHXP)
- ON-OFF-ON rocker switch [I like this chunky one (2 for $13) but there are cheaper options](https://www.amazon.com/gp/product/B07PDQN6P8)
- 7.5-9V 1A DC power supply (any higher than 9V and you'll be dumping a lot of power into the LM317s as heat) [I used this 8.5V one $8 on Amazon](https://www.amazon.com/gp/product/B08CH9C3K6)

### Circuit

![Circuit Schematic](./docs/circuit-schematic-0.svg)

### Resistor values and power dissipation

Here's [a very detailed explanation](https://theparanoidtroll.com/2011/01/05/constant-current-sourceload-lm317/) of using a LM317 voltage regulator to build a constant current source.

**TLDR; to find the value of resistor, use the equation `R = 1.25V / I` where `I` is the desired current in amps.**

In my example, I want the red LED to get 313ma so that it's close to its maximum brightness. So `1.25V / 0.313A = 4Ω` or 5x 20Ω resistors in parallel.

I want the green LED to get 167ma, so `1.25V / 0.167A = 7.5Ω` or 2x 15Ω resistors in parallel. I am using almost twice as much current for the red LED because green appears much brighter to the human eye and therefore a good luminous yellow needs more red than green IMO.

**To figure out the required power rating or number of resistors needed, multiply `Pr = 1.25V * I`**

So for the red circuit in my example `1.25V * 0.313A = 0.392W` is the power dissipated by my resistor, hence my choice of 5 20Ω resistors which are each rated to dissipate 1/4W of power (it is recommended to double the power rating to allow for headroom and extend the life of the components).

**Finally, let's figure out the heat that will be dissipated by the LM317. To do this, we calculate the voltage drop across it and multiply it by the current `(Vin - Vled - Vref) * I = Pu` where Vin is input voltage, Vled is voltage drop across LED, and Vref is the LM317 reference voltage of 1.25V.**
 
 For my red LED `8.5V - 2.5V - 1.25V = 4.75V`. This is more than the minimum 3V the LM317 needs to operate, but will dissipate `4.75V * 0.313A = 1.49W` of heat. If you are putting this much power into an LM317 you should probably put a heatsink on it and certainly do if you use more than 8.5V with this setup. Mine gets super hot so I added one.

### Notes

- You could improve the efficiency and use a higher voltage power supply by replacing the LM317-resistor pairs (top right) with switching constant current regulators [like this one for $13](https://www.ledsupply.com/led-drivers/buckpuck-dc-led-drivers) but these devices are relatively expensive and you really want one for each LED that you drive.
- You could also simplify this circuit and do away with the buck converter by just using 2 power supplies: a 5v one to power the Pi and a higher voltage LED supply.
- Also FYI, the reason for the higher voltage power supply even though the LEDs themselves only drop 2.5-3.6V is that an LM317 requires at a minimum of 3V voltage drop across it with an additional 1V of headroom. So you want a minimum of 7.6V and not much higher, as the higher you go, the more power gets dumped into heat by the LM317.
- I also looked into using FETs for switching instead of darlingtons, but I don't have any on hand that switch on properly with 3V logic level input and those can be hard to find. If you are switching more powerful LEDs, though, you will likely want to use an N-channel MOSFET, possibly with a logic level shifter [like this $4 one from Adafruit](https://www.adafruit.com/product/757).