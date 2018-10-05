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

  
  let erc20
  let landRegistry
  let proxy
  let estate
  let marketplace
  let marketAddress
  let marketInstance
  let assetId
  let market

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

    // create land registry and proxy
    landRegistry = await LANDRegistry.new({from: owner})
    proxy = await LANDProxy.new({from: owner})

    await proxy.upgrade(landRegistry.address, owner, {from: owner})

    land = await LANDRegistry.at(proxy.address)

    // create estate
    estate = await EstateRegistry.new()
    data = encodeCall(
      "initialize",
      ['string', 'string', 'address'], 
      ['Estate', 'EST', land.address]
    );
    estate1 = await estate.sendTransaction({data, from: owner})
    estateAddress = await estate1.logs[0].address
    estateInstance = await EstateRegistry.at(estateAddress)

    await land.initialize(owner, {from: owner})
    await land.setEstateRegistry(estateAddress, {from: owner})

    // Create a Marketplace
    marketplace = await Marketplace.new()
    data = encodeCall(
      "initialize",
      ['address'], [erc20.address]
    );
    market = await marketplace.sendTransaction({data, from: owner})
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

  describe('createOrder', function() {
    beforeEach(async function() {
      await land.authorizeDeploy(seller, {from: owner})
      // assigns land ownership to seller
      await land.assignNewParcel(0, 1, seller, {from: owner})
      assetId = await land.encodeTokenId(0, 1)
    })
    it('it should create a new order with the correct parameters with nftAddress getApproved as the path for meeting the require', async function() {
      await land.approve(marketAddress, assetId, {from: seller})
      const { logs } = await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })

      logs.length.should.be.equal(1)
      logs[0].event.should.be.equal('OrderCreated')

      // check orderCreated logs
      logs[0].args.assetId.should.be.bignumber.equal(assetId)
      logs[0].args.seller.should.be.equal(seller)
      logs[0].args.nftAddress.should.be.equal(land.address)
      logs[0].args.priceInWei.should.be.bignumber.equal(itemPrice)
      logs[0].args.expiresAt.should.be.bignumber.equal(endTime)

      //check order of data
      let s = await marketInstance.orderByAssetId.call(land.address, assetId)
      s[1].should.be.equal(seller)
      s[2].should.be.equal(land.address)
      s[3].should.be.bignumber.equal(itemPrice)
      s[4].should.be.bignumber.equal(endTime)
    })

    it('it should create a new order with the correct parameters with nftAddress isApprovedForAll as the path for meeting the require', async function() {
      await land.setApprovalForAll(marketAddress, true, {from: seller})
      const { logs } = await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      logs.length.should.be.equal(1)
      logs[0].event.should.be.equal('OrderCreated')

      // check orderCreated logs
      logs[0].args.assetId.should.be.bignumber.equal(assetId)
      logs[0].args.seller.should.be.equal(seller)
      logs[0].args.nftAddress.should.be.equal(land.address)
      logs[0].args.priceInWei.should.be.bignumber.equal(itemPrice)
      logs[0].args.expiresAt.should.be.bignumber.equal(endTime)

      //check order of data
      let s = await marketInstance.orderByAssetId.call(land.address, assetId)
      s[1].should.be.equal(seller)
      s[2].should.be.equal(land.address)
      s[3].should.be.bignumber.equal(itemPrice)
      s[4].should.be.bignumber.equal(endTime)
    })

    it('it should transfer publicationFeeInWei to owner', async function() {
      // set publication fee
      const publicationFee = web3.toWei(.05, 'ether')
      await marketInstance.setPublicationFee(publicationFee, {from: owner})

      // get initial balance of owner
      const initialBalance = await erc20.balanceOf(owner)
      
      await erc20.approve(marketAddress, 1e30, { from: seller })
      await erc20.setBalance(seller, web3.toWei(10, 'ether'))
      await land.approve(marketAddress, assetId, {from: seller})

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller})

      // get balance of owner after order was created
      const endingBalance = await erc20.balanceOf(owner)

      endingBalance.sub(initialBalance).should.be.bignumber.equal(publicationFee)
    })

    it('it should revert if the msg.sender does not own the assetId and the asset is an estate', async function() {
      await land.assignMultipleParcels([1, 0], [1, 2], seller, {from: owner})
      estateId = await land.createEstate.call([1, 0], [1, 2], seller, {from: seller})
      await land.approve(marketAddress, estateId, {from: seller})
      await marketInstance.createOrder(land.address, estateId, itemPrice, endTime, { from: otherAddress })
      .should.be.rejectedWith(EVMRevert)
    })

    it('it should revert if the msg.sender does not own the assetId and the asset is land', async function() {
      await land.assignMultipleParcels([1], [2], seller, {from: owner})
      await land.approve(marketAddress, assetId, {from: seller})
      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: otherAddress })
      .should.be.rejectedWith(EVMRevert)
    })

    it('it should revert if the msg.sender puts land for sale and owns the land but only via an estate, so they don\'t technically own the assetId', async function() {
      await land.approve(marketAddress, assetId, {from: seller})
      await land.createEstate([0], [1], seller, {from: seller})
      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      .should.be.rejectedWith(EVMRevert)

    })
    it('it should revert if contract is paused', async function() {
      await land.approve(marketAddress, assetId, {from: seller})
      await marketInstance.pause({from: owner})
      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      .should.be.rejectedWith(EVMRevert)
    })
    it('it should revert if msg.sender does not have enough tokens to pay the publicationFeeInWei', async function() {
      // set publication fee
      const publicationFee = web3.toWei(.05, 'ether')
      await marketInstance.setPublicationFee(publicationFee, {from: owner})

      
      await erc20.approve(marketAddress, 1e30, { from: seller })
      await erc20.setBalance(seller, web3.toWei(.01, 'ether'))
      await land.approve(marketAddress, assetId, {from: seller})

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller})
      .should.be.rejectedWith(EVMRevert)
    })

  })

  describe('cancelOrder', function() {
    beforeEach(async function() {
      await land.authorizeDeploy(seller, {from: owner})
      // assigns land ownership to seller
      await land.assignNewParcel(0, 1, seller, {from: owner})
      assetId = await land.encodeTokenId(0, 1)
      await land.approve(marketAddress, assetId, {from: seller})
      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
    })
    it('it should revert if msg.sender is not the seller or the owner of the contract', async function() {
      await marketInstance.cancelOrder(land.address, assetId, { from: otherAddress })
      .should.be.rejectedWith(EVMRevert)
    })
    it('it should revert if contract is paused', async function() {
      await marketInstance.pause({from: owner})
      await marketInstance.cancelOrder(land.address, assetId, { from: otherAddress })
      .should.be.rejectedWith(EVMRevert)
    })
  })

//*** INTEGRATION TESTS ***//

  describe('createOrder', function() {
    beforeEach(async function() {
      await land.authorizeDeploy(seller, {from: owner})
      // assigns land ownership to seller
      await land.assignNewParcel(0, 1, seller, {from: owner})
      assetId = await land.encodeTokenId(0, 1)
    })
    it('it should transfer the accepted token to owner (in the correct amount based on publication fee, if that fee is greater than 0) and create an order', async function() {
      // set publication fee
      const publicationFee = web3.toWei(.05, 'ether')
      await marketInstance.setPublicationFee(publicationFee, {from: owner})

      // get initial balance of owner
      const initialBalance = await erc20.balanceOf(owner)
      
      await erc20.approve(marketAddress, 1e30, { from: seller })
      await erc20.setBalance(seller, web3.toWei(10, 'ether'))
      await land.approve(marketAddress, assetId, {from: seller})

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller})

      // get balance of owner after order was created
      const endingBalance = await erc20.balanceOf(owner)

      endingBalance.sub(initialBalance).should.be.bignumber.equal(publicationFee)

    })

    it('it should replace any existing orders for that assetId and nftAddress', async function() {
      await land.approve(marketAddress, assetId, {from: seller})
      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
    })

  })

})