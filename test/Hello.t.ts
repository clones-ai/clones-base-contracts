import { expect } from "chai";
import { ethers } from "hardhat";

describe("Hello", function () {
    it("should return the initial greeting", async function () {
        const Hello = await ethers.getContractFactory("Hello");
        const hello = await Hello.deploy("Hello CLONES!");
        await hello.waitForDeployment();

        expect(await hello.greet()).to.equal("Hello CLONES!");
    });

    it("should update the greeting", async function () {
        const Hello = await ethers.getContractFactory("Hello");
        const hello = await Hello.deploy("Hello CLONES!");
        await hello.waitForDeployment();

        await hello.setGreeting("Bonjour");
        expect(await hello.greet()).to.equal("Bonjour");
    });
});
