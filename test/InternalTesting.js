const BigNumber = web3.BigNumber
const encodeCall = require('zos-lib/lib/helpers/encodeCall').default

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should()

const EVMThrow = 'invalid opcode'
const EVMRevert = 'VM Exception while processing transaction: revert'

const ERC20Token = artifacts.require('FakeERC20')
const LANDRegistry = artifacts.require('LANDRegistry')
const EstateRegistry = artifacts.require('EstateRegistry')
const LANDProxy = artifacts.require('LANDProxy')
const Marketplace = artifacts.require('Marketplace')

const { increaseTime, duration } = require('./helpers/increaseTime')

contract('Marketplace', function([_, owner, seller, buyer, otherAddress]) {
  const itemPrice = web3.toWei(1.0, 'ether')
  // const assetId = '0x0000000000000000000000000000000000000000000000000000000000000001'

  let market
  let erc20
  let landRegistry
  let proxy
  let assetId

  let endTime

  const creationParams = {
    from: owner,
    gas: 6e6,
    gasPrice: 21e9
  }

  function getEndTime(minutesAhead = 15) {
   return web3.eth.getBlock('latest').timestamp + duration.minutes(minutesAhead)
  }

  beforeEach(async function() {
    // Create token
    erc20 = await ERC20Token.new(creationParams)

    // create land registry
    landRegistry = await LANDRegistry.new({from: owner})

    // create land proxy
    proxy = await LANDProxy.new({from: owner})
    await proxy.upgrade(landRegistry.address, owner, {from: owner})
    land = await LANDRegistry.at(proxy.address)
    await land.initialize(owner, {from: owner})

    // create estate
    estate = await EstateRegistry.new('Estate', 'EST', proxy.address, {from: owner})

    // Create a Marketplace
    marketplace = await Marketplace.new()
    data = encodeCall(
      "initialize",
      ['address'], [erc20.address]
    );
    market = await marketplace.sendTransaction( {data, from: owner})
    marketAddress = await market.logs[0].address;
    marketInstance = await Marketplace.at(marketAddress)

    endTime = getEndTime()
  })

  describe('Initialize', function() {
    it('should initialize msg.sender as the owner', async function() {
			let sender = await marketInstance.owner()
			sender.should.be.equal(owner)
    })

    it('should fail if initialized twice', async function() {
      data = encodeCall("initialize",['address'],[erc20.address])
      await marketplace
        .sendTransaction({data, from: owner})
        .should.be.rejectedWith(EVMRevert)
    })
  })

})