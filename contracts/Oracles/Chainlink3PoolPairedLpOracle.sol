// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.14;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../Dependencies/BaseMath.sol";
import "./BaseOracle.sol";

/// @title ChainlinkOracle
/// @notice An Implementation of the IOracle for single Chainlink feeds.
/// Assumptions: If a Chainlink Aggregator is not working as intended (e.g. calls revert (excl. getRoundData))
/// then the methods `value` will revert as well
contract Chainlink3PoolPairedLpOracle is BaseOracle {

    /// ======== Custom Errors ======== ///

    error ChainlinkOracle__feed_invalid();
    error ChainlinkOracle__value_invalidValue();

    /// ======== Variables ======== ///

    address public immutable feed;
    uint256 public immutable timeout;
    uint256 public immutable scale;

    address public immutable usdcFeed;
    uint256 public immutable usdcTimeout;
    uint256 public immutable usdcScale;

    address public immutable daiFeed;
    uint256 public immutable daiTimeout;
    uint256 public immutable daiScale;

    address public immutable usdtFeed;
    uint256 public immutable usdtTimeout;
    uint256 public immutable usdtScale;

    /// @param _feed Address of the Chainlink feed
    /// @param _timeout Unique identifier
    constructor(
        address _chfFeed,
        uint256 _chfFeedTimeout,
        address _feed,
        uint256 _timeout,
        address _usdcFeed,
        uint256 _usdcTimeout,
        address _daiFeed,
        uint256 _daiTimeout,
        address _usdtFeed,
        uint256 _usdtTimeout
    ) BaseOracle (_chfFeed, _chfFeedTimeout) {
        feed = _feed;
        timeout = _timeout;
        scale = 10**DECIMAL_PRECISION / 10**AggregatorV3Interface(_feed).decimals();

        usdcFeed = _usdcFeed;
        usdcTimeout = _usdcTimeout;
        usdcScale = 10**DECIMAL_PRECISION / 10**AggregatorV3Interface(_usdcFeed).decimals();

        daiFeed = _daiFeed;
        daiTimeout = _daiTimeout;
        daiScale = 10**DECIMAL_PRECISION / 10**AggregatorV3Interface(_daiFeed).decimals();

        usdtFeed = _usdtFeed;
        usdtTimeout = _usdtTimeout;
        usdtScale = 10**DECIMAL_PRECISION / 10**AggregatorV3Interface(_usdtFeed).decimals();
    }

    /// ======== Chainlink Oracle Implementation ======== ///

    /// @notice Retrieves the latest spot price for a `token` from the corresponding Chainlink feed
    /// @dev Makes minimal sanity checks and reverts if Chainlink returns invalid data
    /// @return value_ Spot price retrieved from the latest round data [DECIMAL_PRECISION]
    // TODO: add curve pool's virtualPrice
    function _feedValue()
        internal
        view
        override (BaseOracle)
        returns (uint256 value_, uint256 timestamp_)
    {

        // compute robust 3pool value
        (uint256 usdcValue, ) = _fetchValidValue(usdcFeed, usdcTimeout, usdcScale);
        (uint256 daiValue, ) = _fetchValidValue(daiFeed, daiTimeout, daiScale);
        (uint256 usdtValue, ) = _fetchValidValue(usdtFeed, usdtTimeout, usdtScale);
        uint256 pool3Value = min(usdcValue, min(daiValue, usdtValue));

        // compute robust 3pool-paired LP oracle value
        (uint256 feedValue, ) = _fetchValidValue(feed, timeout, scale);
        value_ = min(feedValue, pool3Value);

        // also return timestamp
        // TODO: return oldest round's timestamp here?
        timestamp_ = block.timestamp;
    }

    // Returns the smallest of two numbers
	function min(uint256 a, uint256 b) internal pure returns (uint256) {
		return a < b ? a : b;
	}
}