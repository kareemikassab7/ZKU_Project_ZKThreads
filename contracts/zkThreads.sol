//SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@appliedzkp/semaphore-contracts/interfaces/IVerifier.sol";
import "@appliedzkp/semaphore-contracts/base/SemaphoreCore.sol";
import "@appliedzkp/semaphore-contracts/base/SemaphoreGroups.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract zkThreads is SemaphoreCore, SemaphoreGroups, Ownable {
    ///////////////// Variables

    struct Thread {
        uint256 threadId;
        address owner;
        //uint256 state;
    }

    struct Comment {
        uint256 commentId;
        uint256 likes; // total number of votes
    }

    struct Reply {
        uint256 replyId;
        uint256 reply_threadId;
        uint256 reply_commentId;
        uint256 likes; // total number of votes
    }

    mapping(uint256 => Thread) public Threads;
    mapping(bytes32 => Comment) public Comments;
    mapping(bytes32 => Reply) public Replies;
    mapping(uint256 => uint256[]) public threadIdentityCommitments; // threadId => identityCommitment[]
    mapping(uint256 => uint256[]) public threadCommentList; // threadId => commentId[]
    mapping(uint256 => uint256[]) public commentRepliesList; // commentId => replyId[]

    IVerifier public verifier;
    ///////////////// Events
    event NewThread();
    event NewComment(uint256 threadId, uint256 commentId, bytes32 signal);
    event NewReply(uint256 threadId, uint256 commentId, uint256 replyId);
    event CommentLiked(uint256 threadId, uint256 commentId, uint256 likes);
    event ReplyLiked(
        uint256 threadId,
        uint256 commentId,
        uint256 replyId,
        uint256 likes
    );

    ///////////////// Modifiers
    ///////////////// Functions

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
        Comment memory q = Comment({commentId: commentId, likes: 0});
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
        Reply memory q = Reply({replytId: replyId, likes: 0});
        Replies[id] = q;

        _saveNullifierHash(nullifierHash);
        emit NewReply(threadId, commentId, replyId, signal);
    }

    function likeComment(
        uint256 sessionId,
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
        Comments[id].likes += 1;

        // Prevent double-voting of the same comment
        _saveNullifierHash(nullifierHash);

        emit CommentLiked(sessionId, commentId, Comments[id].likes);
        return (commentId, Comments[id].likes);
    }

    /*
        function likeReply(
        uint256 sessionId,
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
        Comments[id].likes += 1;

        // Prevent double-voting of the same comment
        _saveNullifierHash(nullifierHash);

        emit CommentLiked(sessionId, commentId, Comments[id].likes);
        return (commentId, Comments[id].likes);
    }*/
}
