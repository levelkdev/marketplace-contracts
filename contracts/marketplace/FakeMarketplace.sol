pragma solidity ^0.4.23;

import "./Marketplace.sol";


contract FakeMarketplace is Marketplace {
  constructor(address _acceptedToken) public
  Marketplace(_acceptedToken)
  { }

  function executeOrder(
    address nftAddress,
    uint256 assetId,
    uint256 price
  )
   public
   whenNotPaused
  {
    executeOrderWithCheck(
      nftAddress,
      assetId,
      price,
      ""
    );
  }
}
