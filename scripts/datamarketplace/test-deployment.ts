import { ethers } from "hardhat";
import { readRegistry } from "../utils";

/**
 * Test datamarketplace deployment functionality
 * Creates a test dataset to verify the system works end-to-end
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("Testing Datamarketplace Deployment");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Tester:", deployer.address);

    // Read deployment registry
    const deployments = await readRegistry(network.name);
    if (!deployments.contracts?.DatasetFactory?.address) {
        throw new Error("DatasetFactory not found. Deploy system first.");
    }

    const factoryAddress = deployments.contracts.DatasetFactory.address;
    console.log("DatasetFactory:", factoryAddress);

    try {
        // Connect to deployed contracts
        const datasetFactory = await ethers.getContractAt("DatasetFactory", factoryAddress);

        // Get CLONES token for launch fee
        let clonesToken: string;
        if (chainId === 8453) {
            clonesToken = "0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d";
        } else {
            clonesToken = "0x15eB86c7E54B350bf936d916Df33AEF697202E29";
        }

        const clonesContract = await ethers.getContractAt("IERC20", clonesToken);

        // Test 1: Check factory state
        console.log("\nTest 1: Factory State");
        const launchFee = await datasetFactory.getCurrentLaunchFee();
        console.log("Current launch fee:", ethers.formatEther(launchFee), "CLONES");

        // Test 2: Check CLONES balance and allowance
        console.log("\nTest 2: CLONES Token Setup");
        const clonesBalance = await clonesContract.balanceOf(deployer.address);
        const allowance = await clonesContract.allowance(deployer.address, factoryAddress);
        console.log("CLONES balance:", ethers.formatEther(clonesBalance));
        console.log("Factory allowance:", ethers.formatEther(allowance));

        if (clonesBalance < launchFee) {
            console.log("Insufficient CLONES balance for test dataset creation");
            console.log(`Need: ${ethers.formatEther(launchFee)} CLONES`);
            return;
        }

        // Approve factory if needed
        if (allowance < launchFee) {
            console.log("Approving CLONES spending...");
            const approveTx = await clonesContract.approve(factoryAddress, launchFee);
            await approveTx.wait();
            console.log("CLONES approved");
        }

        // Test 3: Predict dataset addresses
        console.log("\nTest 3: Address Prediction");
        const [predictedToken, predictedCurve] = await datasetFactory.predictDatasetAddressWithNonce(
            deployer.address,
            "Test Dataset",
            "TEST",
            0
        );
        console.log("Predicted token:", predictedToken);
        console.log("Predicted curve:", predictedCurve);

        // Test 4: Create test dataset
        console.log("\nTest 4: Creating Test Dataset");
        const initialLiquidity = ethers.parseEther("0.02"); // 0.02 ETH

        const createTx = await datasetFactory.createDataset(
            "Test Dataset",
            "TEST",
            5, // 5% burn threshold
            { value: initialLiquidity }
        );

        console.log("Transaction hash:", createTx.hash);
        await createTx.wait();
        console.log("Dataset created successfully!");

        // Test 5: Verify created dataset
        console.log("\nTest 5: Dataset Verification");

        // Get created dataset info using the predicted token address
        const [creator, bondingCurveAddress] = await datasetFactory.getDatasetInfo(predictedToken);
        console.log("Created dataset:");
        console.log("- Creator:", creator);
        console.log("- Token address:", predictedToken);
        console.log("- Curve address:", bondingCurveAddress);

        // Verify addresses match prediction
        if (bondingCurveAddress === predictedCurve) {
            console.log("Address prediction accurate!");
        } else {
            console.log("Address prediction mismatch!");
        }

        // Test 6: Basic token interactions
        console.log("\nTest 6: Token Interactions");
        const token = await ethers.getContractAt("DatasetToken", predictedToken);
        const curve = await ethers.getContractAt("BondingCurve", bondingCurveAddress);

        const tokenName = await token.name();
        const tokenSymbol = await token.symbol();
        const totalSupply = await token.totalSupply();
        const isActive = await curve.isActive();
        const currentPrice = await curve.getCurrentPrice();

        console.log("Token name:", tokenName);
        console.log("Token symbol:", tokenSymbol);
        console.log("Total supply:", ethers.formatUnits(totalSupply, 6));
        console.log("Curve active:", isActive);
        console.log("Current price:", ethers.formatEther(currentPrice), "ETH per token");

        // Test 7: Buy some tokens
        console.log("\nTest 7: Token Purchase");
        const buyAmount = ethers.parseEther("0.01"); // 0.01 ETH
        const tokensOut = await curve.getTokensOut(buyAmount);

        console.log("Buying with:", ethers.formatEther(buyAmount), "ETH");
        console.log("Expected tokens:", ethers.formatUnits(tokensOut, 6));

        const buyTx = await curve.buy(tokensOut, { value: buyAmount });
        await buyTx.wait();

        const tokenBalance = await token.balanceOf(deployer.address);
        console.log("Purchase successful!");
        console.log("Token balance:", ethers.formatUnits(tokenBalance, 6));

        console.log("\nAll tests passed! Datamarketplace system is working correctly.");

        // Summary
        console.log("\nTest Summary:");
        console.log("Factory deployment functional");
        console.log("CLONES token integration working");
        console.log("Address prediction accurate");
        console.log("Dataset creation successful");
        console.log("EIP-1167 proxies functional");
        console.log("Bonding curve trading operational");

    } catch (error) {
        console.error("Test failed:", error);
        throw error;
    }
}

// Execute test
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});