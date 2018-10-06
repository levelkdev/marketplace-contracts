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
  let assetId2
  let market
  let publicationFee
  let ownersCut

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

    // Create land registry
    landRegistry = await LANDRegistry.new({from: owner})
    proxy = await LANDProxy.new({from: owner})
    await proxy.upgrade(landRegistry.address, owner, {from: owner})

    land = await LANDRegistry.at(proxy.address)

    // create Estate
    estate = await EstateRegistry.new()
    data = encodeCall(
      "initialize",
      ['string', 'string', 'address'], 
      ['Estate', 'EST', land.address]
    );
    estate1 = await estate.sendTransaction({data, from: owner})
    estateAddress = await estate1.logs[0].address;
    estateInstance = await EstateRegistry.at(estateAddress)

    await land.initialize(owner, {from: owner})
    await land.setEstateRegistry(estateAddress, {from: owner})

    await land.authorizeDeploy(seller, {from: owner})
    await land.assignNewParcel(0, 1, seller, {from: owner})
    await land.assignNewParcel(0, 2, seller, {from: owner})
    await land.assignNewParcel(5, 5, seller, {from: owner})
    await land.assignNewParcel(5, 6, seller, {from: owner})
    assetId = await land.encodeTokenId(5, 5)

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

  describe('createOrder', function() {
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

    it('it should revert if the msg.sender does not own the assetId and the asset is an estate', async function() {
      await land.createEstate([5,5],[5,6], seller, {from: seller})
      estateId = await estateInstance.getLandEstateId(assetId)
      await land.approve(marketAddress, estateId, {from: seller})
      await marketInstance.createOrder(land.address, estateId, itemPrice, endTime, { from: otherAddress })
      .should.be.rejectedWith(EVMRevert)
    })

    it('it should revert if the msg.sender does not own the assetId and the asset is land', async function() {
      await land.approve(marketAddress, assetId, {from: seller})
      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: otherAddress })
      .should.be.rejectedWith(EVMRevert)
    })

    it('it should revert if the msg.sender puts land for sale and owns the land but only via an estate, so they don\'t technically own the assetId', async function() {
      await land.approve(marketAddress, assetId, {from: seller})
      await land.createEstate([5,5],[5,6], seller, {from: seller})
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

  describe('safeExecuteOrder', function() {
    beforeEach(async function() {
      await land.setApprovalForAll(marketInstance.address, true, {from: seller})
      await land.setApprovalForAll(marketInstance.address, true, {from: buyer})

      await estateInstance.setApprovalForAll(marketInstance.address, true, {from: seller})
      await estateInstance.setApprovalForAll(marketInstance.address, true, {from: buyer})
     
      // Assign balance to buyer and allow marketplace to move ERC20
      await erc20.setBalance(buyer, web3.toWei(10, 'ether'))
      await erc20.approve(marketInstance.address, 1e30, { from: seller })
      await erc20.approve(marketInstance.address, 1e30, { from: buyer })

      await land.createEstate([5,5],[5,6], seller, {from: seller})

      estateId = await estateInstance.getLandEstateId(assetId)
      estateOwner = await estateInstance.ownerOf(estateId)
      fingerprint = await estateInstance.getFingerprint(estateId)
    })

    it('should succeed if the NFT supports the desired interface and the asset fingerprint is valid', async function() {
      estateOwner.should.be.equal(seller)
      await marketInstance.createOrder(
        estateAddress, 
        estateId, 
        itemPrice, 
        endTime, 
        { from: seller }
      )
      await marketInstance.safeExecuteOrder(
        estateAddress, 
        estateId, 
        itemPrice, 
        fingerprint, 
        { from: buyer }
      )  
      newEstateOwner = await estate.ownerOf(estateId);
      newEstateOwner.should.be.equal(buyer)
    })

    it('should revert if the NFT registry does not support creating fingerprints', async function() {
      let assetId = await land.encodeTokenId(0, 1)
      await marketInstance.createOrder(
        land.address,
        assetId,
        itemPrice,
        endTime,
        { from: seller }
      )
      await marketInstance.safeExecuteOrder(
        land.address, 
        assetId, 
        itemPrice, 
        fingerprint,
        { from: buyer }
      ).should.be.rejectedWith(EVMRevert)
    })

    it('should revert if the fingerprint is not valid', async function() {
      invalidFingerPrint = 0x00000;

      await marketInstance.createOrder(
        estateAddress, 
        estateId, 
        itemPrice, 
        endTime, 
        { from: seller }
      )
      await marketInstance.safeExecuteOrder(
        estateAddress, 
        estateId, 
        itemPrice, 
        invalidFingerPrint, 
        { from: buyer }
      ).should.be.rejectedWith(EVMRevert)  
    })

    it('should revert if the contract is paused', async function() {
      await marketInstance.createOrder(
        estateAddress, 
        estateId, 
        itemPrice, 
        endTime, 
        { from: seller }
      )
      await marketInstance.pause({ from: owner })
      await marketInstance.safeExecuteOrder(
        estateAddress, 
        estateId, 
        itemPrice, 
        fingerprint, 
        { from: buyer }
      ).should.be.rejectedWith(EVMRevert)  
    })
  })

  describe('executeOrder', function() {
    beforeEach(async function() {
      await land.setApprovalForAll(marketInstance.address, true, {from: seller})
      await land.setApprovalForAll(marketInstance.address, true, {from: buyer})
     
      // Assign balance to buyer and allow marketplace to move ERC20
      await erc20.setBalance(buyer, web3.toWei(10, 'ether'))
      await erc20.setBalance(seller, web3.toWei(10, 'ether'))

      await erc20.approve(marketInstance.address, 1e30, { from: seller })
      await erc20.approve(marketInstance.address, 1e30, { from: buyer })
    })
    it('should call _executeOrder', async function() {
      publicationFee = web3.toWei(0.5, 'ether')
      await marketInstance.setPublicationFee(publicationFee, { from: owner })

      tokenOwner = await land.ownerOfLand(5, 5)
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      newTokenOwner = await land.ownerOfLand(5, 5);
      newTokenOwner.should.be.equal(buyer)
    }) 

    it('should revert if the contract is paused', async function() {
      publicationFee = web3.toWei(0.5, 'ether')
      await marketInstance.setPublicationFee(publicationFee, { from: owner })

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.pause({ from: owner })
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer })
      .should.be.rejectedWith(EVMRevert)
    })
  })

  describe('_executeOrder', function() {
    beforeEach(async function() {
      await land.setApprovalForAll(marketInstance.address, true, {from: seller})
      await land.setApprovalForAll(marketInstance.address, true, {from: buyer})
     
      // Assign balance to buyer and allow marketplace to move ERC20
      await erc20.setBalance(buyer, web3.toWei(10, 'ether'))
      await erc20.setBalance(seller, web3.toWei(10, 'ether'))

      await erc20.approve(marketInstance.address, 1e30, { from: seller })
      await erc20.approve(marketInstance.address, 1e30, { from: buyer })
    })
    it('should transfer the NFT to the msg.sender', async function() {
      publicationFee = web3.toWei(0.2, 'ether')
      await marketInstance.setPublicationFee(publicationFee, { from: owner })

      tokenOwner = await land.ownerOfLand(5, 5)
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      newTokenOwner = await land.ownerOfLand(5, 5)
      newTokenOwner.should.be.equal(buyer)
    })

    it('should transfer the correct amount of the accepted token to the seller', async function() {
      publicationFee = web3.toWei(0.2, 'ether')
      await marketInstance.setPublicationFee(publicationFee, { from: owner })

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      // should be equal to balance + itemPrice - publicationFee
      endingBalanceSeller = await erc20.balanceOf(seller)
      endingBalanceSeller.should.be.bignumber.equal(web3.toWei(10.8, 'ether'))
    })

    it('should transfer the owner\'s cut to the owner', async function() {
      publicationFee = web3.toWei(0.2, 'ether')
      ownerCut = 10;
      await marketInstance.setPublicationFee(publicationFee, { from: owner })  
      await marketInstance.setOwnerCut(ownerCut, { from: owner })  

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      // should be equal to ownerCut and publication Fee
      afterOwnerBalance = await erc20.balanceOf(owner)
      afterOwnerBalance.should.be.bignumber.equal(web3.toWei(0.3, 'ether'))
    })

    it('should revert if the price is incorrect', async function() {
      publicationFee = web3.toWei(0.2, 'ether')
      await marketInstance.setPublicationFee(publicationFee, { from: owner }) 

      tokenOwner = await land.ownerOfLand(5,5)
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
        
      await marketInstance.executeOrder(land.address, assetId, web3.toWei(0.5, 'ether'), { from: buyer})
      .should.be.rejectedWith(EVMRevert)
    })

    it('should revert if order has expired', async function() {
      publicationFee = web3.toWei(0.2, 'ether')
      await marketInstance.setPublicationFee(publicationFee, { from: owner })

      tokenOwner = await land.ownerOfLand(5,5)
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })

      // move an hour ahead
      await increaseTime(3600)
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})
      .should.be.rejectedWith(EVMRevert)
    })

    it('should revert if the seller is no longer the owner', async function() {
      publicationFee = web3.toWei(0.2, 'ether')
      await marketInstance.setPublicationFee(publicationFee, { from: owner })

      tokenOwner = await land.ownerOfLand(5,5)
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      // Seller no longer owns the NFT
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})
      .should.be.rejectedWith(EVMRevert)
    })

    it('should revert if no such asset exists with that assetId', async function() {
      publicationFee = web3.toWei(0.2, 'ether')
      await marketInstance.setPublicationFee(publicationFee, { from: owner })
      let incorrectAssetId = await land.encodeTokenId(2, 0)

      tokenOwner = await land.ownerOfLand(5,5)
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, incorrectAssetId, itemPrice, endTime, { from: seller })
      .should.be.rejectedWith(EVMRevert)
    })
  })

//*** INTEGRATION TESTS ***//

  describe('createOrder', function() {
    beforeEach(async function() {
      await land.setApprovalForAll(marketInstance.address, true, {from: seller})
      await land.setApprovalForAll(marketInstance.address, true, {from: buyer})
     
      // Assign balance to buyer and allow marketplace to move ERC20
      await erc20.setBalance(buyer, web3.toWei(10, 'ether'))
      await erc20.setBalance(seller, web3.toWei(10, 'ether'))

      await erc20.approve(marketInstance.address, 1e30, { from: seller })
      await erc20.approve(marketInstance.address, 1e30, { from: buyer })
    })
    it('it should transfer the accepted token to owner (in the correct amount based on publication fee, if that fee is greater than 0) and create an order', async function() {
      publicationFee = web3.toWei(0.2, 'ether')
      await marketInstance.setPublicationFee(publicationFee, { from: owner })

      const initialBalance = await erc20.balanceOf(owner)
      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller})
      const endingBalance = await erc20.balanceOf(owner)

      // balance should be equal to publication fee 
      endingBalance.sub(initialBalance).should.be.bignumber.equal(publicationFee)
    })

    it('it should replace any existing orders for that assetId and nftAddress', async function() {
      let newPrice = web3.toWei(2.0, 'ether')
      let newEndTime = endTime + duration.minutes(5)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      existingOrder = await marketInstance.orderByAssetId(land.address, assetId)

      await marketInstance.createOrder(land.address, assetId, newPrice, newEndTime, { from: seller })
      newOrder = await marketInstance.orderByAssetId(land.address, assetId)
      newOrder[0].should.not.equal(existingOrder[0])
      newOrder[1].should.be.equal(seller)
      newOrder[2].should.be.equal(land.address)
      newOrder[3].should.be.bignumber.equal(newPrice)
      newOrder[4].should.be.bignumber.equal(newEndTime)
    })
  })

  describe('executeOrder', function() {
    beforeEach(async function() {
      await land.setApprovalForAll(marketInstance.address, true, {from: seller})
      await land.setApprovalForAll(marketInstance.address, true, {from: buyer})
     
      // Assign balance to buyer, seller, buyer and allow marketplace to move ERC20
      await erc20.setBalance(owner, web3.toWei(10, 'ether'))
      await erc20.setBalance(buyer, web3.toWei(10, 'ether'))
      await erc20.setBalance(seller, web3.toWei(10, 'ether'))

      await erc20.approve(marketInstance.address, 1e30, { from: seller })
      await erc20.approve(marketInstance.address, 1e30, { from: buyer })
    })
    it('Land: it should transfer the ownerCut to the owner (if the owner cut is > 0), accepted token to seller, the land to the buyer, and delete the order', async function() {
      // set publication fee and ownerCut
      publicationFee = web3.toWei(0.2, 'ether')
      ownerCut = 10;

      await marketInstance.setPublicationFee(publicationFee, { from: owner })  
      await marketInstance.setOwnerCut(ownerCut, { from: owner }) 

      tokenOwner = await land.ownerOfLand(5,5)
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller }) 
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      // should transfer the ownerCut and publication fee to the owner (balance + ownersCut + publicationFee)
      endingBalanceOwner = await erc20.balanceOf(owner)
      endingBalanceOwner.should.be.bignumber.equal(web3.toWei(10.3, 'ether'))

      // should transfer the accepted token to the seller (balance + itemPrice - ownersCut - publicationFee)
      endingBalanceSeller = await erc20.balanceOf(seller)
      endingBalanceSeller.should.be.bignumber.equal(web3.toWei(10.7, 'ether'))

      // should transfer the land to the buyer
      newTokenOwner = await land.ownerOfLand(5,5)
      newTokenOwner.should.be.equal(buyer)

      // check that order was deleted
      deletedOrder = await marketInstance.orderByAsset(land.address, assetId)
      deletedOrder[0].should.be.equal('0x0000000000000000000000000000000000000000000000000000000000000000')
      deletedOrder[1].should.be.equal('0x0000000000000000000000000000000000000000')
      deletedOrder[2].should.be.equal('0x0000000000000000000000000000000000000000')
      deletedOrder[3].should.not.equal(itemPrice)
      deletedOrder[4].should.not.equal(endTime)
    })

    it('Land: When the owner cut is 0, it should transfer the accepted token to seller, the land to the buyer, and delete the order', async function() {
      // set publication fee and ownerCut
      let publicationFee = web3.toWei(0.2, 'ether')

      await marketInstance.setPublicationFee(publicationFee, { from: owner })  

      tokenOwner = await land.ownerOfLand(5,5)
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller }) 
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      // should transfer the ownerCut and publication fee to the owner (balance + publicationFee)
      endingBalanceOwner = await erc20.balanceOf(owner)
      endingBalanceOwner.should.be.bignumber.equal(web3.toWei(10.2, 'ether'))

      // should transfer the accepted token to the seller (balance + itemPrice - publicationFee)
      endingBalanceSeller = await erc20.balanceOf(seller)
      endingBalanceSeller.should.be.bignumber.equal(web3.toWei(10.8, 'ether'))

      // should transfer the land to the buyer
      newTokenOwner = await land.ownerOfLand(5,5);
      newTokenOwner.should.be.equal(buyer)

      // check that order was deleted
      deletedOrder = await marketInstance.orderByAsset(land.address, assetId)
      deletedOrder[0].should.be.equal('0x0000000000000000000000000000000000000000000000000000000000000000')
      deletedOrder[1].should.be.equal('0x0000000000000000000000000000000000000000')
      deletedOrder[2].should.be.equal('0x0000000000000000000000000000000000000000')
      deletedOrder[3].should.not.equal(itemPrice)
      deletedOrder[4].should.not.equal(endTime)
    })

  })

})