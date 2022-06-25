//SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@appliedzkp/semaphore-contracts/interfaces/IVerifier.sol";
import "@appliedzkp/semaphore-contracts/base/SemaphoreCore.sol";
import "@appliedzkp/semaphore-contracts/base/SemaphoreGroups.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/*///////////////////////////Insights///////////////////////////
- can be extended to actual threads with categories later and communities later
- state is to be considered to remove threads, comments, replies later
//////////////////////////////////////////////////////////////*/

contract zkThreads is SemaphoreCore, SemaphoreGroups, Ownable {
    ///////////////// Variables

    // Optimization: can be made an enum later
    uint256 constant NOT_STARTED = 1;
    uint256 constant PAUSED = 2;
    uint256 constant ACTIVE = 3;
    uint256 constant ENDED = 4;
    uint256 constant MAX_QUESTIONS = 100;

    struct Thread {
        uint256 threadId;
        address owner;
        uint256 state;
    }

    struct Comment {
        uint256 commentId;
        uint256 upvotes; // total number of votes
        // can add disupvotes/downvotes
    }

    struct Reply {
        uint256 replyId;
        uint256 reply_threadId;
        uint256 reply_commentId;
        uint256 upvotes; // total number of votes
        // can add disupvotes/downvotes
        // can add reply to reply later
    }

    mapping(uint256 => Thread) public Threads; // map thread Ids to Thread objects
    mapping(bytes32 => Comment) public Comments; // map hash of thread and comment Ids to Comment objects
    mapping(bytes32 => Reply) public Replies; // map hash of thread and comment and reply Ids to Reply objects
    mapping(uint256 => uint256[]) public threadIdentityCommitments; // threadId => identityCommitment[]
    mapping(uint256 => uint256[]) public threadCommentsMapping; // threadId => commentId[]
    mapping(uint256 => uint256[]) public commentRepliesMapping; // commentId => replyId[]

    IVerifier public verifier;
    uint256 fee = 1000000000000000000; // default fee
    ///////////////// Events /////////////////////////////////////////////////////////////////////////////////////////////
    event NewThread(uint256 indexed threadId);
    event NewComment(uint256 threadId, uint256 commentId, bytes32 signal);
    event NewReply(
        uint256 threadId,
        uint256 commentId,
        uint256 replyId,
        bytes32 signal
    );

    event CommentLiked(uint256 threadId, uint256 commentId, uint256 upvotes);
    event ReplyLiked(
        uint256 threadId,
        uint256 commentId,
        uint256 replyId,
        uint256 upvotes
    );
    // can be added later
    /* event CommentDisLiked(
        uint256 threadId,
        uint256 commentId,
        uint256 downvotes
    );
    event ReplyDisLiked(
        uint256 threadId,
        uint256 commentId,
        uint256 replyId,
        uint256 downvotes
    );*/

    event UserJoinedThread(
        uint256 indexed threadId,
        uint256 identityCommitment
    );
    event UserLeftThread(uint256 indexed threadId, uint256 identityCommitment);

    event ThreadStatusChanged(uint256 threadId, uint256 statusId);
    event FeeChanged(uint256 newFee);

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////// Modifiers

    modifier threadNotStarted(uint256 threadId) {
        require(
            Threads[threadId].state == NOT_STARTED,
            "AMA session's state should be Not Started"
        );
        _;
    }
    modifier threadActive(uint256 threadId) {
        require(
            Threads[threadId].state == ACTIVE,
            "AMA session's state is not Active"
        );
        _;
    }
    modifier threadPaused(uint256 threadId) {
        require(
            Threads[threadId].state == PAUSED,
            "AMA session's state is not Paused"
        );
        _;
    }
    // not used
    modifier threadEnded(uint256 threadId) {
        require(Threads[threadId].state == ENDED, "AMA session has Ended");
        _;
    }
    modifier canJoinThread(uint256 threadId) {
        require(
            Threads[threadId].state == PAUSED ||
                Threads[threadId].state == ACTIVE,
            "AMA session's state is not Paused or Active"
        );
        _;
    }
    modifier threadExists(uint256 threadId) {
        require(
            Threads[threadId].owner != address(0),
            "AMA session does not exist"
        );
        _;
    }
    modifier onlyThreadOwner(uint256 threadId) {
        require(
            Threads[threadId].owner == msg.sender,
            "You are not the owner of this AMA session"
        );
        _;
    }
    modifier notOverQuestionLimit(uint256 threadId) {
        require(
            threadCommentsMapping[threadId].length < MAX_QUESTIONS,
            "Maximum number of questions posted."
        );
        _;
    }

    ///////////////// Functions
    constructor(address _verifier) {
        verifier = IVerifier(_verifier);
    }

    function createThread(uint256 threadId) external payable {
        require(
            msg.value >= fee,
            " Insufficient funds for creating a new Thread"
        );

        _createGroup(threadId, 20, 0);

        Threads[threadId] = Thread({
            threadId: threadId,
            owner: msg.sender,
            state: NOT_STARTED
        });

        emit NewThread(threadId);
    }

    function joinThread(uint256 threadId, uint256 identityCommitment)
        external
        threadExists(threadId)
        canJoinThread(threadId)
    {
        _addMember(threadId, identityCommitment);
        threadIdentityCommitments[threadId].push(identityCommitment);

        emit UserJoinedThread(threadId, identityCommitment);
    }

    function postComment(
        uint256 threadId,
        uint256 commentId,
        bytes32 signal,
        uint256 root,
        uint256 nullifierHash,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external {
        require(
            _isValidProof(
                signal,
                root,
                nullifierHash,
                externalNullifier,
                proof,
                verifier
            ),
            "Thread: the proof is not valid"
        );
        // commentId is unique across all sessions
        bytes32 id = keccak256(abi.encodePacked(commentId));
        Comment memory q = Comment({commentId: commentId, upvotes: 0});
        Comments[id] = q;

        _saveNullifierHash(nullifierHash);
        emit NewComment(threadId, commentId, signal);
    }

    function postReply(
        uint256 threadId,
        uint256 commentId,
        uint256 replyId,
        bytes32 signal,
        uint256 root,
        uint256 nullifierHash,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external {
        require(
            _isValidProof(
                signal,
                root,
                nullifierHash,
                externalNullifier,
                proof,
                verifier
            ),
            "Thread: the proof is not valid"
        );
        // commentId is unique across all sessions
        bytes32 id = keccak256(abi.encodePacked(replyId));
        Reply memory q = Reply({
            replyId: replyId,
            reply_threadId: threadId,
            reply_commentId: commentId,
            upvotes: 0
        });

        Replies[id] = q;

        _saveNullifierHash(nullifierHash);
        emit NewReply(threadId, commentId, replyId, signal);
    }

    function likeComment(
        uint256 threadId,
        uint256 commentId,
        bytes32 signal,
        uint256 root,
        uint256 nullifierHash,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external returns (uint256, uint256) {
        require(
            _isValidProof(
                signal,
                root,
                nullifierHash,
                externalNullifier,
                proof,
                verifier
            ),
            "AMA: the proof is not valid"
        );

        // add votes to comment. commentId is unique across all sessions
        bytes32 id = keccak256(abi.encodePacked(commentId));
        Comments[id].upvotes += 1;

        // Prevent double-voting of the same comment
        _saveNullifierHash(nullifierHash);

        emit CommentLiked(threadId, commentId, Comments[id].upvotes);
        return (commentId, Comments[id].upvotes);
    }

    function getIdentityCommitments(uint256 threadId)
        external
        view
        returns (uint256[] memory)
    {
        return threadIdentityCommitments[threadId];
    }

    function likeReply(
        uint256 threadId,
        uint256 commentId,
        uint256 replyId,
        bytes32 signal,
        uint256 root,
        uint256 nullifierHash,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external returns (uint256, uint256) {
        require(
            _isValidProof(
                signal,
                root,
                nullifierHash,
                externalNullifier,
                proof,
                verifier
            ),
            "the proof is not valid"
        );

        // add votes to comment. commentId is unique across all sessions
        bytes32 id = keccak256(abi.encodePacked(replyId));
        Replies[id].upvotes += 1;

        // Prevent double liking of the same comment
        _saveNullifierHash(nullifierHash);

        emit ReplyLiked(threadId, commentId, replyId, Replies[id].upvotes);
        return (replyId, Replies[id].upvotes);
    }

    function startThread(uint256 threadId)
        external
        threadExists(threadId)
        onlyThreadOwner(threadId)
        threadNotStarted(threadId)
    {
        Threads[threadId].state = ACTIVE;
        emit ThreadStatusChanged(threadId, ACTIVE);
    }

    // @dev Pause an AMA session. Sets session state to Paused. Participants cannot post questions when status is Paused.
    // @param threadId Unique session id
    function pauseThread(uint256 threadId)
        external
        threadExists(threadId)
        onlyThreadOwner(threadId)
        threadActive(threadId)
    {
        Threads[threadId].state = PAUSED;
        emit ThreadStatusChanged(threadId, PAUSED);
    }

    // @dev Resume a paused AMA session. Sets session state to Active.
    // @param threadId Unique session id
    function resumeThread(uint256 threadId)
        external
        threadExists(threadId)
        onlyThreadOwner(threadId)
        threadPaused(threadId)
    {
        Threads[threadId].state = ACTIVE;
        emit ThreadStatusChanged(threadId, ACTIVE);
    }

    // @dev End an AMA session. Sets session state to Ended.
    // @param threadId Unique session id
    function endThread(uint256 threadId)
        external
        threadExists(threadId)
        onlyThreadOwner(threadId)
    {
        Threads[threadId].state = ENDED;
        emit ThreadStatusChanged(threadId, ENDED);
    }

    // @dev Get fee payable for creating an AMA session
    // @return Current fee in wei
    function getFee() public view returns (uint256) {
        return fee;
    }

    /** onlyOwner functions **/
    // @dev Change fee payable for creating an AMA session
    // @param _fee Fee in wei
    function changeFee(uint256 _fee) external onlyOwner {
        fee = _fee;
        emit FeeChanged(_fee);
    }

    // @dev Get contract balance
    // @return Contract balance
    function getAvailableFunds() external view onlyOwner returns (uint256) {
        return address(this).balance;
    }

    // @dev Get contract owner's balance
    // @return Contract owner's balance
    function getOwnerBalance() external view onlyOwner returns (uint256) {
        return address(owner()).balance;
    }

    // @dev Withdraw contract balance to contract owner's so funds are not stuck in contract
    // @return Remaining contract balance after withdrawal
    function withdrawFunds() external onlyOwner returns (uint256) {
        payable(owner()).transfer(address(this).balance);
        return address(this).balance;
    }

    fallback() external payable {}

    receive() external payable {}
}
