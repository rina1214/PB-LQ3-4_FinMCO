// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract CampusVoting is Ownable {
    struct Candidate {
        uint256 id;
        string name;
        string position;
        uint256 voteCount;
        bool exists;
    }

    uint256 public candidateCount;
    uint256 public totalVotes;
    bool public electionOpen;

    mapping(uint256 => Candidate) public candidates;
    mapping(address => bool) public authorizedVoters;
    mapping(address => bool) public hasVoted;

    event CandidateAdded(uint256 indexed candidateId, string name);
    event VoterAuthorized(address indexed voter);
    event VoteCast(address indexed voter, uint256 indexed candidateId);
    event ElectionStatusChanged(bool isOpen);

    constructor() Ownable(msg.sender) {
        electionOpen = false;
    }

    function addCandidate(
        string calldata _name,
        string calldata _position
    ) external onlyOwner {
        require(bytes(_name).length > 0, "Candidate name is required");
        require(!electionOpen, "Cannot add candidates after election starts");

        candidateCount++;

        candidates[candidateCount] = Candidate({
            id: candidateCount,
            name: _name,
            position: _position,
            voteCount: 0,
            exists: true
        });

        emit CandidateAdded(candidateCount, _name);
    }

    function authorizeVoter(address _voter) external onlyOwner {
        require(_voter != address(0), "Invalid voter address");
        require(!electionOpen, "Cannot authorize voters after election starts");

        authorizedVoters[_voter] = true;

        emit VoterAuthorized(_voter);
    }

    function startElection() external onlyOwner {
        require(candidateCount >= 2, "Add at least two candidates");
        require(!electionOpen, "Election is already open");

        electionOpen = true;

        emit ElectionStatusChanged(true);
    }

    function endElection() external onlyOwner {
        require(electionOpen, "Election is not open");

        electionOpen = false;

        emit ElectionStatusChanged(false);
    }

    function vote(uint256 _candidateId) external {
        require(electionOpen, "Election is not open");
        require(authorizedVoters[msg.sender], "You are not authorized to vote");
        require(!hasVoted[msg.sender], "You have already voted");
        require(candidates[_candidateId].exists, "Invalid candidate");

        hasVoted[msg.sender] = true;
        candidates[_candidateId].voteCount++;
        totalVotes++;

        emit VoteCast(msg.sender, _candidateId);
    }

    function getCandidate(
        uint256 _candidateId
    ) external view returns (Candidate memory) {
        require(candidates[_candidateId].exists, "Invalid candidate");
        return candidates[_candidateId];
    }

    function getCandidateCount() external view returns (uint256) {
        return candidateCount;
    }

    function getTotalVotes() external view returns (uint256) {
        return totalVotes;
    }

    function getElectionStatus() external view returns (bool) {
        return electionOpen;
    }
}
