import { Strategy, ZkIdentity } from "@zk-kit/identity"
import { generateMerkleProof, genExternalNullifier, Semaphore, StrBigInt } from "@zk-kit/protocols"
import { expect } from "chai"
import { Contract, Signer } from "ethers"
import { ethers, run } from "hardhat"
describe("zkThreads", function () {
    let contract: Contract
    const DEPTH = 20;
    const ZERO_VALUE = BigInt(0);
    const WASM_FILEPATH = "./public/semaphore.wasm"
    const FINAL_ZKEY_FILEPATH = "./public/semaphore_final.zkey"
    const IDENTITY_MESSAGE = "Sign this message to create your identity!";

    // declare test data
    const threadIds = [BigInt(1), BigInt(2)];
    const commentIds = [BigInt(1), BigInt(2)];
    const replyIds = [BigInt(1), BigInt(2)];
    // declare session states
    const PAUSED = 2;
    const ACTIVE = 3;
    const ENDED = 4;

    // declare some test accounts
    let signers: Signer[];
    let alice: Signer;
    let bob: Signer;
    let charlie: Signer;

    before(async () => {
        contract = await run("deploy", { logs: false })
        signers = await ethers.getSigners()
        alice = signers[0];
        bob = signers[1];
        charlie = signers[2];
    })

    describe("Threads ( Semaphore Groups)", () => {
        it("Should create a new Thread", async () => {
            const transaction = contract.createThread(threadIds[0], { value: ethers.utils.parseEther("1") });
            await expect(transaction).to.emit(contract, "NewThread").withArgs(threadIds[0])
        })

        it("Should not create a duplicated Thread", async () => {
            const transaction = contract.createThread(threadIds[0], { value: ethers.utils.parseEther("1") });
            await expect(transaction).to.be.revertedWith("SemaphoreGroups: group already exists");
        })

        it("Should not create a Thread with insufficient funds", async () => {
            const transaction = contract.createThread(threadIds[1], { value: ethers.utils.parseEther("0.5") });
            await expect(transaction).to.be.revertedWith("Insufficient funds for creating a Thread");
        })

        it("Should change fee for creating a Thread", async () => {
            const transaction = contract.changeFee(ethers.utils.parseEther("2"));
            await expect(transaction).to.emit(contract, "FeeChanged").withArgs(ethers.utils.parseEther("2"))
        })

        it("Should be able to create another Thread", async () => {
            const transaction = contract.createThread(threadIds[1], { value: ethers.utils.parseEther("2") });
            await expect(transaction).to.emit(contract, "NewThread").withArgs(threadIds[1]);
        })

        it("Should start the Thread", async () => {
            const transaction = contract.startThread(threadIds[0]);
            await expect(transaction).to.emit(contract, "ThreadStatusChanged").withArgs(threadIds[0], ACTIVE)
        })

        it("Should join a Thread (Alice)", async () => {
            // create an identity commitment for the user
            const message = await alice.signMessage(IDENTITY_MESSAGE)

            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const transaction = contract.joinThread(threadIds[0], identityCommitment);
            await expect(transaction).to.emit(contract, "UserJoinedThread").withArgs(threadIds[0], identityCommitment)
        })

        it("Should join a Thread (Bob)", async () => {
            // create an identity commitment for the user
            const message = await bob.signMessage(IDENTITY_MESSAGE)

            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const transaction = contract.joinThread(threadIds[0], identityCommitment);
            await expect(transaction).to.emit(contract, "UserJoinedThread").withArgs(threadIds[0], identityCommitment)
        })

        it("Should join a Thread (Charlie)", async () => {
            // create an identity commitment for the user
            const message = await charlie.signMessage(IDENTITY_MESSAGE)

            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const transaction = contract.joinThread(threadIds[0], identityCommitment);
            await expect(transaction).to.emit(contract, "UserJoinedThread").withArgs(threadIds[0], identityCommitment)
        })
    })

    describe("# Thread Comments and Replies (a.k.a Signals)", () => {
        let identity: ZkIdentity;
        let identityCommitment: bigint;
        let identityCommitments: StrBigInt[] = [];
        let signals = ["post", "vote"]; // user can post/like a dicussion opinion (comment or reply) //Improvement: ppl can like multiple comments, aka each comment is a semaphore group
        let bytes32Signal0: string;

        before(async () => {
            // create an identity commitment for the user
            const message = await alice.signMessage(IDENTITY_MESSAGE)
            identity = new ZkIdentity(Strategy.MESSAGE, message)
            identityCommitment = identity.genIdentityCommitment()

            bytes32Signal0 = ethers.utils.formatBytes32String(signals[0])

            // fetch identity commitments for threadIds[0]
            const identityCommitmentsBN = await contract.getIdentityCommitments(threadIds[0]);
            for (var i = 0; i < identityCommitmentsBN.length; i++) {
                identityCommitments.push(identityCommitmentsBN[i].toString());
            }
        });

        it("Should add a comment to Thread #1 (Alice)", async () => {
            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[0]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.postComment(threadIds[0], commentIds[0], bytes32Signal0, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "NewComment").withArgs(threadIds[0], commentIds[0], bytes32Signal0)
        })

        it("Should add a reply to comment #1 to Thread #1 (Alice)", async () => {
            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}_${replyIds[0]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[0]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.postReply(threadIds[0], commentIds[0], replyIds[0], bytes32Signal0, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "NewReply").withArgs(threadIds[0], commentIds[0], replyIds[0], bytes32Signal0)
        })

        it("Should add another comment to Thread #1 (Alice)", async () => {
            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[1]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[0]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.postComment(threadIds[0], commentIds[1], bytes32Signal0, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "NewComment").withArgs(threadIds[0], commentIds[1], bytes32Signal0)
        })
        it("Should another a reply #2 to comment #1 to Thread #1 (Alice)", async () => {
            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}_${replyIds[1]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[0]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.postReply(threadIds[0], commentIds[0], replyIds[1], bytes32Signal0, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "NewReply").withArgs(threadIds[0], commentIds[0], replyIds[1], bytes32Signal0)
        })

        it("Should not post same comment to Thread #1 (Alice)", async () => {
            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[1]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[0] // post
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.postComment(threadIds[0], commentIds[1], bytes32Signal0, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.be.revertedWith("SemaphoreCore: you cannot use the same nullifier twice");
        })
        
        it("Should not post same reply 2 to comment 2 to Thread #1 (Alice)", async () => {
            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}_${replyIds[1]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[0] // post
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.postReply(threadIds[0], commentIds[0], replyIds[1], bytes32Signal0, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.be.revertedWith("SemaphoreCore: you cannot use the same nullifier twice");
        })
        it("Should not post and like the same comment to Thread #1 (Alice)", async () => {
            // user who posts the question cannot upvote/like his/her own question
            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[1]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1] // vote/like
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.postComment(threadIds[0], commentIds[0], bytes32Signal0, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.be.revertedWith("SemaphoreCore: you cannot use the same nullifier twice");
        })
        
        it("Should not post and like the same Reply to Thread #1 (Alice)", async () => {
            // user who posts the question cannot upvote/like his/her own question
            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}_${replyIds[0]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1] // vote/like
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.postReply(threadIds[0], commentIds[0], replyIds[0], bytes32Signal0, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.be.revertedWith("SemaphoreCore: you cannot use the same nullifier twice");
        })
        it("Should like Alice's comment in Thread #1 (Bob -> Comment #1)", async () => {
            // create an identity commitment for the user
            const message = await bob.signMessage(IDENTITY_MESSAGE)
            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            let bytes32Signal1 = ethers.utils.formatBytes32String(signals[1])

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.likeComment(threadIds[0], commentIds[0], bytes32Signal1, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "CommentLiked").withArgs(threadIds[0], commentIds[0], 1) // 1 vote
        })
        it("Should like Alice's reply in Thread #1 (Bob -> reply #1)", async () => {
            // create an identity commitment for the user
            const message = await bob.signMessage(IDENTITY_MESSAGE)
            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}_${replyIds[0]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            let bytes32Signal1 = ethers.utils.formatBytes32String(signals[1])

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.likeReply(threadIds[0], commentIds[0], replyIds[0], bytes32Signal1, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "ReplyLiked").withArgs(threadIds[0], commentIds[0], replyIds[0], 1) // 1 vote
        })
        it("Should like Alice's comment in Thread #1 (Charlie -> Comment #1)", async () => {
            // create an identity commitment for the user
            const message = await charlie.signMessage(IDENTITY_MESSAGE)
            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            let bytes32Signal1 = ethers.utils.formatBytes32String(signals[1])

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.likeComment(threadIds[0], commentIds[0], bytes32Signal1, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "CommentLiked").withArgs(threadIds[0], commentIds[0], 2) // 2 votes: 1 from bob and 1 from charlie
        })
        it("Should give another like to Alice's reply in Thread #1 (Charlie -> reply #1)", async () => {
            // create an identity commitment for the user
            const message = await charlie.signMessage(IDENTITY_MESSAGE)
            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}_${replyIds[0]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            let bytes32Signal1 = ethers.utils.formatBytes32String(signals[1])

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.likeReply(threadIds[0], commentIds[0], replyIds[0], bytes32Signal1, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "ReplyLiked").withArgs(threadIds[0], commentIds[0], replyIds[0], 2) // 1 vote
        })
        it("Should like Alice's second comment in Thread #1 (Bob -> Comment #2)", async () => {
            // create an identity commitment for the user
            const message = await bob.signMessage(IDENTITY_MESSAGE)
            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[1]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            let bytes32Signal1 = ethers.utils.formatBytes32String(signals[1])

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.likeComment(threadIds[0], commentIds[1], bytes32Signal1, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "CommentLiked").withArgs(threadIds[0], commentIds[1], 1) // 1 vote
        })
        it("Should like Alice's reply 2 in Thread #1 (Bob -> reply #2)", async () => {
            // create an identity commitment for the user
            const message = await bob.signMessage(IDENTITY_MESSAGE)
            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}_${replyIds[1]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            let bytes32Signal1 = ethers.utils.formatBytes32String(signals[1])

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.likeReply(threadIds[0], commentIds[0], replyIds[1], bytes32Signal1, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.emit(contract, "ReplyLiked").withArgs(threadIds[0], commentIds[0], replyIds[1], 1) // 1 vote
        })
        it("Should not like Alice's second comment in Thread #1 AGAIN (Bob -> Comment #1)", async () => {
            // create an identity commitment for the user
            const message = await bob.signMessage(IDENTITY_MESSAGE)
            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()

            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[1]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())

            let bytes32Signal1 = ethers.utils.formatBytes32String(signals[1])

            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1]
            )

            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)

            const transaction = contract.likeComment(threadIds[0], commentIds[0], bytes32Signal1, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.be.revertedWith("SemaphoreCore: you cannot use the same nullifier twice");
        })
        it("Should not like Alice's second Reply in Thread #1 AGAIN (Bob -> Reply #2)", async () => {
            // create an identity commitment for the user
            const message = await bob.signMessage(IDENTITY_MESSAGE)
            const identity = new ZkIdentity(Strategy.MESSAGE, message)
            const identityCommitment = identity.genIdentityCommitment()
    
            const merkleProof = generateMerkleProof(DEPTH, ZERO_VALUE, identityCommitments, identityCommitment);
            const nullifier = `${threadIds[0]}_${commentIds[0]}_${replyIds[1]}`;
            const externalNullifier = genExternalNullifier(nullifier);
            const commentNullifier = Semaphore.genNullifierHash(externalNullifier, identity.getNullifier())
    
            let bytes32Signal1 = ethers.utils.formatBytes32String(signals[1])
    
            const witness = Semaphore.genWitness(
                identity.getTrapdoor(),
                identity.getNullifier(),
                merkleProof,
                commentNullifier,
                signals[1]
            )
    
            const { proof, publicSignals } = await Semaphore.genProof(witness, WASM_FILEPATH, FINAL_ZKEY_FILEPATH);
            const solidityProof = Semaphore.packToSolidityProof(proof)
    
            const transaction = contract.likeReply(threadIds[0], commentIds[0], replyIds[1], bytes32Signal1, merkleProof.root, publicSignals.nullifierHash, publicSignals.externalNullifier, solidityProof)
            await expect(transaction).to.be.revertedWith("SemaphoreCore: you cannot use the same nullifier twice");
        })
    })

    describe("# Thread state", () => {
        it("Should pause the Thread", async () => {
            const transaction = contract.pauseThread(threadIds[0]);
            await expect(transaction).to.emit(contract, "ThreadStatusChanged").withArgs(threadIds[0], PAUSED)
        })

        it("Should resume a paused Thread", async () => {
            const transaction = contract.resumeThread(threadIds[0]);
            await expect(transaction).to.emit(contract, "ThreadStatusChanged").withArgs(threadIds[0], ACTIVE)
        })

        it("Should end the Thread", async () => {
            const transaction = contract.endThread(threadIds[0]);
            await expect(transaction).to.emit(contract, "ThreadStatusChanged").withArgs(threadIds[0], ENDED)
        })

        it("Should not start a Thread that has ended", async () => {
            const transaction = contract.startThread(threadIds[0]);
            await expect(transaction).to.be.revertedWith("Thread's state should be Not Started");
        })
    })

    describe("# Funds can be withdrawn (not stuck in contract)", () => {
        it("Should have 3 ethers in contract", async () => {
            const transaction = await contract.getAvailableFunds();
            // console.log(await contract.getOwnerBalance())
            await expect(transaction).to.be.equal(ethers.utils.parseEther("3"));
        })

        it("Should be able to withdraw funds from contract", async () => {
            const transaction = await contract.withdrawFunds();
            await expect(transaction.value).to.be.equal(0);
        })

        it("Should have 0 ethers in contract", async () => {
            const transaction = await contract.getAvailableFunds();
            // console.log(await contract.getOwnerBalance())
            await expect(transaction).to.be.equal(ethers.utils.parseEther("0"));
        })
    })
})