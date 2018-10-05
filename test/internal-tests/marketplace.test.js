const BigNumber = web3.BigNumber

const encodeCall = require('zos-lib/lib/helpers/encodeCall').default

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should()

const EVMThrow = 'invalid opcode'
const EVMRevert = 'VM Exception while processing transaction: revert'

const ERC20Token = artifacts.require('FakeERC20')
const ERC721Token = artifacts.require('FakeERC721')
const Marketplace = artifacts.require('Marketplace')

const EstateRegistry = artifacts.require('EstateRegistry')
const LANDProxy = artifacts.require('LANDProxy')
const LANDRegistry = artifacts.require('LANDRegistry')

const { increaseTime, duration } = require('./../helpers/increaseTime')

function getEndTime(minutesAhead = 15) {
  return web3.eth.getBlock('latest').timestamp + duration.minutes(minutesAhead)
}

contract('Marketplace', function(accounts) {
	const itemPrice = web3.toWei(1.0, 'ether')

  const owner = accounts[0]
  const seller = accounts[1]
  const buyer = accounts[2]

  let endTime

  const creationParams = {
    from: owner,
    gas: 6e6,
    gasPrice: 21e9
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
    await land.setEstateRegistry(estateAddress)

    await land.authorizeDeploy(seller, {from: owner})
    await land.assignNewParcel(0, 1, seller, {from: owner})
    await land.assignNewParcel(0, 2, seller, {from: owner})
    await land.assignNewParcel(5, 5, seller, {from: owner})
    await land.assignNewParcel(5, 6, seller, {from: owner})

    // Create a Marketplace
    marketplace = await Marketplace.new()
    data = encodeCall(
      "initialize",
      ['address'], [erc20.address]
    );
    market = await marketplace.sendTransaction( {data, from: owner})
    marketAddress = await market.logs[0].address;
    marketInstance = await Marketplace.at(marketAddress)

    await land.setApprovalForAll(marketInstance.address, true, {from: seller})
    await land.setApprovalForAll(marketInstance.address, true, {from: buyer})

    await estateInstance.setApprovalForAll(marketInstance.address, true, {from: seller})
    await estateInstance.setApprovalForAll(marketInstance.address, true, {from: buyer})
   
    // Assign balance to buyer and allow marketplace to move ERC20
    await erc20.setBalance(buyer, web3.toWei(10, 'ether'))
    await erc20.approve(marketInstance.address, 1e30, { from: seller })
    await erc20.approve(marketInstance.address, 1e30, { from: buyer })

  	endTime = getEndTime()
  })

	describe('safeExecuteOrder', function() {
    beforeEach(async function() {
      let assetId = await land.encodeTokenId(5, 5)
      let assetId2 = await land.encodeTokenId(5, 6)

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
	  it('should call _executeOrder', async function() {
      let publicationFee = web3.toWei(0.5, 'ether')
      let assetId = await land.encodeTokenId(0, 1)

	  	tokenOwner = await land.ownerOfLand(0,1);
	    tokenOwner.should.be.equal(seller)

		  await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.setPublicationFee(publicationFee, { from: owner })  	
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      newTokenOwner = await land.ownerOfLand(0,1);
      newTokenOwner.should.be.equal(buyer)
	  }) 

	  it('should revert if the contract is paused', async function() {
      let publicationFee = web3.toWei(0.5, 'ether')
      let assetId = await land.encodeTokenId(0, 1)

	  	await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.setPublicationFee(publicationFee, { from: owner })
      await marketInstance.pause({ from: owner })
   	  await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer })
   	  .should.be.rejectedWith(EVMRevert)
	  })
	})

	describe('_executeOrder', function() {
    it('should transfer the NFT to the msg.sender', async function() {
      let publicationFee = web3.toWei(0.5, 'ether')
      let assetId = await land.encodeTokenId(0, 1)

      tokenOwner = await land.ownerOfLand(0,1);
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.setPublicationFee(publicationFee, { from: owner })   
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      newTokenOwner = await land.ownerOfLand(0,1);
      newTokenOwner.should.be.equal(buyer)
    })

    it('should transfer the correct amount of the accepted token to the seller', async function() {
      let publicationFee = web3.toWei(0.5, 'ether')
      let assetId = await land.encodeTokenId(0, 1)

      beforeSellerBalance = await erc20.balanceOf(seller)
      beforeSellerBalance.should.be.bignumber.equal(0, 'ether')

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.setPublicationFee(publicationFee, { from: owner })  
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      afterSellerBalance = await erc20.balanceOf(seller)
      afterSellerBalance.should.be.bignumber.equal(itemPrice)
    })

    it('should transfer the owner\'s cut to the owner', async function() {
      let publicationFee = web3.toWei(0.5, 'ether')
      let assetId = await land.encodeTokenId(0, 1)
      let ownerCut = 10;

      beforeOwnerBalance = await erc20.balanceOf(owner)
      beforeOwnerBalance.should.be.bignumber.equal(0, 'ether')

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.setPublicationFee(publicationFee, { from: owner })  
      await marketInstance.setOwnerCut(ownerCut, { from: owner })  
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      afterOwnerBalance = await erc20.balanceOf(owner)
      afterOwnerBalance.should.be.bignumber.equal((itemPrice * ownerCut) / 100, 'ether')
    })

    it('should revert if the price is incorrect', async function() {
      let publicationFee = web3.toWei(0.5, 'ether')
      let assetId = await land.encodeTokenId(0, 1)

      tokenOwner = await land.ownerOfLand(0,1);
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.setPublicationFee(publicationFee, { from: owner })   
      await marketInstance.executeOrder(land.address, assetId, web3.toWei(0.5, 'ether'), { from: buyer})
      .should.be.rejectedWith(EVMRevert)
    })

    it('should revert if order has expired', async function() {
      let publicationFee = web3.toWei(0.5, 'ether')
      let assetId = await land.encodeTokenId(0, 1)

      tokenOwner = await land.ownerOfLand(0,1);
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.setPublicationFee(publicationFee, { from: owner })   
      // move an hour ahead
      await increaseTime(3600)
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})
      .should.be.rejectedWith(EVMRevert)
    })

    it('should revert if the seller is no longer the owner', async function() {
      let publicationFee = web3.toWei(0.5, 'ether')
      let assetId = await land.encodeTokenId(0, 1)

      tokenOwner = await land.ownerOfLand(0,1);
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, assetId, itemPrice, endTime, { from: seller })
      await marketInstance.setPublicationFee(publicationFee, { from: owner })   
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})

      // Seller no longer owns the NFT
      await marketInstance.executeOrder(land.address, assetId, itemPrice, { from: buyer})
      .should.be.rejectedWith(EVMRevert)
    })

    it('should revert if no such asset exists with that assetId', async function() {
      let publicationFee = web3.toWei(0.5, 'ether')
      let assetId = await land.encodeTokenId(0, 1)
      let incorrectAssetId = await land.encodeTokenId(2, 0)

      tokenOwner = await land.ownerOfLand(0,1);
      tokenOwner.should.be.equal(seller)

      await marketInstance.createOrder(land.address, incorrectAssetId, itemPrice, endTime, { from: seller })
      .should.be.rejectedWith(EVMRevert)
    })
	})
})