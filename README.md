## Installation

### Install Node

On a recent PI (2+) nvm should work just fine:
```sh
sudo apt-get install nvm
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
yarn global add typescript pm2
```

If you used nvm, add this to your .bashrc, .zshrc, etc. so you have "pm2" on your path:
```sh
export PATH="$(yarn global bin):$PATH"
```

### Clone on-air and install dependencies

```
git clone https://github.com/benkrejci/on-air.git
cd on-air
yarn install # install deps
yarn build # build JS
yarn start # test to make sure it runs (<Ctrl>+C to exit)
```

### Configure PM2 app

```
pm2 start --name on-air-box dist/index.js # make sure you are still in on-air directory
pm2 startup # follow the instructions if given
pm2 save
```
