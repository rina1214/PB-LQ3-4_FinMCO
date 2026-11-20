const contractAddress = "0xD83A398D87Bc1F2ba1cc62224f6ecC8d5c39eB5F";

// Premade Electoral Admin Credentials
const PREMADE_ADMIN = {
  username: "admin",
  password: "admin123"
};

const contractABI = [
  "function owner() view returns (address)",
  "function addCandidate(string name, string position)",
  "function authorizeVoter(address voter)",
  "function startElection()",
  "function endElection()",
  "function vote(uint256 candidateId)",
  "function getCandidate(uint256 candidateId) view returns (tuple(uint256 id, string name, string position, uint256 voteCount, bool exists))",
  "function getCandidateCount() view returns (uint256)",
  "function getTotalVotes() view returns (uint256)",
  "function getElectionStatus() view returns (bool)",
  "function hasVoted(address voter) view returns (bool)",
  "function authorizedVoters(address voter) view returns (bool)"
];

let provider;
let signer;
let contract;
let userAccount = "";
let contractOwner = "";
let isVoterAuthorized = false;
let isVoterLoggedIn = false;
let isAdminLoggedIn = false;

// Contract-Specific Persistent State (Automatically isolated per deployed address)
let electionState = JSON.parse(localStorage.getItem(`campusVote_${contractAddress.toLowerCase()}_electionState`)) || {
  hasStarted: false,
  hasEnded: false
};

let registeredVoters = JSON.parse(localStorage.getItem(`campusVote_${contractAddress.toLowerCase()}_registeredVoters`)) || [];
let authorizedLocalList = JSON.parse(localStorage.getItem(`campusVote_${contractAddress.toLowerCase()}_authorizedLocalList`)) || [];
let candidates = JSON.parse(localStorage.getItem(`campusVote_${contractAddress.toLowerCase()}_candidates`)) || [];
let userVotes = JSON.parse(localStorage.getItem(`campusVote_${contractAddress.toLowerCase()}_userVotes`)) || [];

function saveStateToStorage() {
  const prefix = `campusVote_${contractAddress.toLowerCase()}_`;
  localStorage.setItem(prefix + "electionState", JSON.stringify(electionState));
  localStorage.setItem(prefix + "registeredVoters", JSON.stringify(registeredVoters));
  localStorage.setItem(prefix + "authorizedLocalList", JSON.stringify(authorizedLocalList));
  localStorage.setItem(prefix + "candidates", JSON.stringify(candidates));
  localStorage.setItem(prefix + "userVotes", JSON.stringify(userVotes));
}

// Centered System Modal Helper
function showSystemMessage(message, title = "System Notice") {
  const overlay = document.getElementById("customModalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalMessage = document.getElementById("modalMessage");

  if (!overlay) return;
  modalTitle.innerText = title;
  modalMessage.innerText = message;
  overlay.classList.remove("hidden");
}

document.getElementById("modalCloseBtn").addEventListener("click", () => {
  document.getElementById("customModalOverlay").classList.add("hidden");
});

// DOM Elements
const connectButton = document.getElementById("connectButton");
const walletStatus = document.getElementById("walletStatus");
const electionStatus = document.getElementById("electionStatus");
const totalVotes = document.getElementById("totalVotes");
const candidateList = document.getElementById("candidateList");

// Navigation
const navVotersBtn = document.getElementById("navVotersBtn");
const navAdminBtn = document.getElementById("navAdminBtn");
const votersPage = document.getElementById("votersPage");
const adminPage = document.getElementById("adminPage");

// Welcome Page Transition (No data reset)
document.getElementById("enterSystemBtn").addEventListener("click", () => {
  document.getElementById("welcomePage").classList.add("hidden");
  document.getElementById("mainSystemContainer").classList.remove("hidden");
  renderElectionUI();
});

// Seamless Tab Switching (No refresh or reload)
navVotersBtn.addEventListener("click", () => {
  navVotersBtn.classList.add("active");
  navAdminBtn.classList.remove("active");
  votersPage.classList.remove("hidden");
  adminPage.classList.add("hidden");
  renderElectionUI();
});

navAdminBtn.addEventListener("click", () => {
  navAdminBtn.classList.add("active");
  navVotersBtn.classList.remove("active");
  adminPage.classList.remove("hidden");
  votersPage.classList.add("hidden");
  checkAdminAccess();
  renderElectionUI();
  populateRegisteredVotersDropdown();
});

// Event Listeners
connectButton.addEventListener("click", connectWallet);
document.getElementById("registerVoterBtn").addEventListener("click", registerVoter);
document.getElementById("voterLoginBtn").addEventListener("click", loginVoter);
document.getElementById("adminLoginBtn").addEventListener("click", loginAdmin);
document.getElementById("adminLogoutBtn").addEventListener("click", logoutAdmin);
document.getElementById("addCandidateButton").addEventListener("click", addCandidate);
document.getElementById("authorizeVoterButton").addEventListener("click", authorizeVoter);
document.getElementById("startElectionButton").addEventListener("click", startElection);
document.getElementById("endElectionButton").addEventListener("click", endElection);

if (window.ethereum) {
  window.ethereum.on("accountsChanged", async () => {
    isVoterLoggedIn = false;
    isAdminLoggedIn = false;
    await connectWallet();
  });
}

async function connectWallet() {
  if (!window.ethereum) {
    walletStatus.innerText = "Please install MetaMask.";
    return;
  }

  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);

  signer = provider.getSigner();
  userAccount = await signer.getAddress();

  contract = new ethers.Contract(contractAddress, contractABI, signer);

  try {
    contractOwner = await contract.owner();
  } catch (e) {
    console.error("Could not fetch contract owner:", e);
  }

  walletStatus.innerText = "Connected: " + userAccount.slice(0, 6) + "..." + userAccount.slice(-4);

  checkVoterStatus();
  checkAdminAccess();
  renderElectionUI();
  populateRegisteredVotersDropdown();
}

function checkVoterStatus() {
  const loginBanner = document.getElementById("voterLoginBanner");
  if (!userAccount) {
    isVoterAuthorized = false;
    isVoterLoggedIn = false;
    if (loginBanner) loginBanner.innerText = "Session: Not Logged In";
    return;
  }

  if (contractOwner && userAccount.toLowerCase() === contractOwner.toLowerCase()) {
    isVoterAuthorized = false;
    isVoterLoggedIn = false;
    if (loginBanner) loginBanner.innerText = "Session: Admin Wallet Connected (Cannot Vote)";
    return;
  }

  const voter = registeredVoters.find((v) => v.wallet.toLowerCase() === userAccount.toLowerCase());
  if (!voter) {
    isVoterAuthorized = false;
    isVoterLoggedIn = false;
    if (loginBanner) loginBanner.innerText = "Session: Wallet Not Registered";
    return;
  }

  isVoterAuthorized = authorizedLocalList.includes(userAccount.toLowerCase());

  if (isVoterLoggedIn && loginBanner) {
    loginBanner.innerText = isVoterAuthorized
      ? `Session: Logged in as ${voter.fullName} (Authorized)`
      : `Session: Logged in as ${voter.fullName} (Pending Admin Authorization)`;
  } else if (loginBanner) {
    loginBanner.innerText = isVoterAuthorized
      ? `Session: Registered & Authorized (${voter.fullName}) — Ready to Login`
      : `Session: Registered (${voter.fullName}) — Waiting for Admin Authorization`;
  }
}

// Voter Login Verification
function loginVoter() {
  if (!userAccount) {
    showSystemMessage("Please connect your MetaMask wallet first.", " Wallet Required");
    return;
  }

  if (contractOwner && userAccount.toLowerCase() === contractOwner.toLowerCase()) {
    showSystemMessage("The Electoral Admin wallet cannot log in as a voter.", " Access Denied");
    return;
  }

  const inputName = document.getElementById("loginFullName").value.trim();
  if (!inputName) {
    showSystemMessage("Please enter your registered Full Name to log in.", " Missing Name");
    return;
  }

  const voter = registeredVoters.find((v) => v.wallet.toLowerCase() === userAccount.toLowerCase());
  if (!voter) {
    showSystemMessage("No registration found for your currently connected MetaMask wallet address.", " Not Registered");
    return;
  }

  if (voter.fullName.toLowerCase() !== inputName.toLowerCase()) {
    showSystemMessage("The Full Name entered does not match the name registered to this MetaMask wallet.", " Login Failed");
    return;
  }

  checkVoterStatus();
  if (!isVoterAuthorized) {
    showSystemMessage("Your wallet is registered, but the Electoral Admin has not authorized you yet. Please wait for admin approval.", " Pending Authorization");
    return;
  }

  isVoterLoggedIn = true;
  document.getElementById("loginFullName").value = "";
  checkVoterStatus();
  showSystemMessage(`Welcome, ${voter.fullName}! You are now logged in and authorized to vote.`, " Voter Login Successful");
  renderElectionUI();
}

// Premade Electoral Admin Login
function loginAdmin() {
  if (!userAccount) {
    showSystemMessage("Please connect your MetaMask wallet first.", " Wallet Required");
    return;
  }

  const username = document.getElementById("adminUsernameInput").value.trim();
  const password = document.getElementById("adminPasswordInput").value.trim();

  if (username !== PREMADE_ADMIN.username || password !== PREMADE_ADMIN.password) {
    showSystemMessage("Invalid premade Electoral Admin username or password.", " Login Failed");
    return;
  }

  if (!contractOwner || userAccount.toLowerCase() !== contractOwner.toLowerCase()) {
    showSystemMessage(
      `Credentials verified, but your connected MetaMask wallet (${userAccount.slice(0, 6)}...) is NOT the official Contract Owner wallet. Switch to Account 1 in MetaMask.`,
      " Wrong Admin Wallet"
    );
    return;
  }

  isAdminLoggedIn = true;
  document.getElementById("adminUsernameInput").value = "";
  document.getElementById("adminPasswordInput").value = "";
  checkAdminAccess();
  showSystemMessage("Welcome, Electoral Admin! Access granted.", " Admin Login Successful");
}

function logoutAdmin() {
  isAdminLoggedIn = false;
  checkAdminAccess();
  showSystemMessage("You have logged out of the Electoral Admin Portal.", " Logged Out");
}

function checkAdminAccess() {
  const adminControlPanel = document.getElementById("adminControlPanel");
  const adminLoginForm = document.getElementById("adminLoginForm");
  const adminPromptText = document.getElementById("adminPromptText");

  const isOwnerConnected = userAccount && contractOwner && userAccount.toLowerCase() === contractOwner.toLowerCase();

  if (isAdminLoggedIn && isOwnerConnected) {
    adminControlPanel.classList.remove("hidden");
    adminLoginForm.classList.add("hidden");
    adminPromptText.innerText = "Admin Access Granted  (Premade Account + Official Contract Owner Wallet Verified)";
  } else {
    isAdminLoggedIn = false;
    adminControlPanel.classList.add("hidden");
    adminLoginForm.classList.remove("hidden");
    adminPromptText.innerText = "Enter the premade Electoral Admin credentials and ensure the Contract Owner wallet is connected in MetaMask.";
  }
}

// 1. Voter Registration
async function registerVoter() {
  if (!userAccount) {
    showSystemMessage("Please connect your MetaMask wallet first.", " Wallet Required");
    return;
  }

  if (electionState.hasEnded) {
    showSystemMessage("This deployed contract's election has permanently ended. Deploy a new contract to run another election.", " One Election Per Contract");
    return;
  }

  if (electionState.hasStarted) {
    showSystemMessage("The election has already started. Registration is closed.", " Registration Closed");
    return;
  }

  if (contractOwner && userAccount.toLowerCase() === contractOwner.toLowerCase()) {
    showSystemMessage("The Electoral Admin wallet address cannot register as a voter.", " Access Denied");
    return;
  }

  const fullName = document.getElementById("regFullName").value.trim();
  if (!fullName) {
    showSystemMessage("Please enter your Full Name.", " Missing Information");
    return;
  }

  const exists = registeredVoters.some((v) => v.wallet.toLowerCase() === userAccount.toLowerCase());
  if (exists) {
    showSystemMessage("This MetaMask wallet address is already registered.", " Already Registered");
    return;
  }

  try {
    const message = `Campus Election Voter Registration\nContract: ${contractAddress}\nName: ${fullName}\nWallet: ${userAccount}`;
    await signer.signMessage(message);

    registeredVoters.push({ fullName, wallet: userAccount });
    saveStateToStorage();

    showSystemMessage(`Registration confirmed for ${fullName}! Switch to the Admin wallet to authorize this voter.`, " Registration Submitted");

    document.getElementById("regFullName").value = "";
    checkVoterStatus();
    populateRegisteredVotersDropdown();
    renderElectionUI();
  } catch (error) {
    console.error(error);
    showSystemMessage("MetaMask confirmation cancelled. Voter registration was not completed.", " Cancelled");
  }
}

function populateRegisteredVotersDropdown() {
  const dropdown = document.getElementById("registeredVotersDropdown");
  if (!dropdown) return;
  dropdown.innerHTML = '<option value="">-- Select Registered Voter to Authorize --</option>';
  registeredVoters.forEach((v) => {
    const option = document.createElement("option");
    option.value = v.wallet;
    const authLabel = authorizedLocalList.includes(v.wallet.toLowerCase()) ? " (Authorized )" : "";
    option.innerText = `${v.fullName} — ${v.wallet.slice(0, 6)}...${v.wallet.slice(-4)}${authLabel}`;
    dropdown.appendChild(option);
  });
}

document.getElementById("registeredVotersDropdown").addEventListener("change", (e) => {
  document.getElementById("voterAddress").value = e.target.value;
});

// 2. Admin Adds Candidate
async function addCandidate() {
  if (!isAdminLoggedIn || !contractOwner || userAccount.toLowerCase() !== contractOwner.toLowerCase()) {
    showSystemMessage("Access Denied: Only the logged-in Electoral Admin can add candidates.", " Admin Only");
    return;
  }

  if (electionState.hasEnded) {
    showSystemMessage("This deployed contract's election has permanently ended. Deploy a new contract for a new election.", " One Election Per Contract");
    return;
  }

  if (electionState.hasStarted) {
    showSystemMessage("Cannot add candidates after the election has started.", " Action Locked");
    return;
  }

  const name = document.getElementById("candidateName").value.trim();
  const position = document.getElementById("candidatePosition").value.trim();

  if (!name || !position) {
    showSystemMessage("Please enter both candidate name and position.", " Missing Candidate Details");
    return;
  }

  try {
    const message = `Admin Action: Add Candidate\nContract: ${contractAddress}\nName: ${name}\nPosition: ${position}`;
    await signer.signMessage(message);

    const newId = candidates.length + 1;
    candidates.push({ id: newId, name, position, voteCount: 0 });
    saveStateToStorage();

    showSystemMessage("Candidate added successfully!", " Candidate Added");
    document.getElementById("candidateName").value = "";
    document.getElementById("candidatePosition").value = "";
    renderElectionUI();
  } catch (error) {
    console.error(error);
    showSystemMessage("MetaMask confirmation cancelled or rejected.", " Action Cancelled");
  }
}

// 3. Admin Authorizes Voter
async function authorizeVoter() {
  if (!isAdminLoggedIn || !contractOwner || userAccount.toLowerCase() !== contractOwner.toLowerCase()) {
    showSystemMessage("Access Denied: Only the logged-in Electoral Admin can authorize voters.", " Admin Only");
    return;
  }

  if (electionState.hasEnded) {
    showSystemMessage("This deployed contract's election has permanently ended. Deploy a new contract for a new election.", " One Election Per Contract");
    return;
  }

  if (electionState.hasStarted) {
    showSystemMessage("Cannot authorize new voters after the election has started.", " Action Locked");
    return;
  }

  const voter = document.getElementById("voterAddress").value.trim();
  if (!voter) {
    showSystemMessage("Please select or enter a registered voter wallet address.", " No Voter Selected");
    return;
  }

  const isRegistered = registeredVoters.some((v) => v.wallet.toLowerCase() === voter.toLowerCase());
  if (!isRegistered) {
    showSystemMessage("This wallet address has not registered as a voter yet.", " Not Registered");
    return;
  }

  if (authorizedLocalList.includes(voter.toLowerCase())) {
    showSystemMessage("This voter is already authorized.", " Already Authorized");
    return;
  }

  try {
    const message = `Admin Action: Authorize Voter\nContract: ${contractAddress}\nWallet: ${voter}`;
    await signer.signMessage(message);

    authorizedLocalList.push(voter.toLowerCase());
    saveStateToStorage();

    showSystemMessage("Voter successfully authorized!", " Voter Authorized");
    document.getElementById("voterAddress").value = "";
    checkVoterStatus();
    populateRegisteredVotersDropdown();
    renderElectionUI();
  } catch (error) {
    console.error(error);
    showSystemMessage("MetaMask confirmation cancelled.", " Action Cancelled");
  }
}

// 4. Admin Starts Election
async function startElection() {
  if (!isAdminLoggedIn || !contractOwner || userAccount.toLowerCase() !== contractOwner.toLowerCase()) {
    showSystemMessage("Access Denied: Only the logged-in Electoral Admin can start the election.", " Admin Only");
    return;
  }

  if (electionState.hasEnded) {
    showSystemMessage("This deployed contract has already completed its single election. Deploy a new contract to run another election.", " One Election Per Contract");
    return;
  }

  if (electionState.hasStarted) {
    showSystemMessage("The election is already open.", " Already Open");
    return;
  }

  if (candidates.length < 2) {
    showSystemMessage("Please add at least 2 candidates before starting.", " Minimum Candidates Required");
    return;
  }

  try {
    const message = `Admin Action: Start Election\nContract: ${contractAddress}`;
    await signer.signMessage(message);

    electionState.hasStarted = true;
    electionState.hasEnded = false;
    saveStateToStorage();

    showSystemMessage("Election STARTED! Registration and candidate setup are now permanently closed.", " Election Started");
    renderElectionUI();
  } catch (error) {
    console.error(error);
    showSystemMessage("MetaMask confirmation cancelled.", " Action Cancelled");
  }
}

// 5. Admin Stops Election Permanently (One election per deployed contract)
async function endElection() {
  if (!isAdminLoggedIn || !contractOwner || userAccount.toLowerCase() !== contractOwner.toLowerCase()) {
    showSystemMessage("Access Denied: Only the logged-in Electoral Admin can stop the election.", " Admin Only");
    return;
  }

  if (electionState.hasEnded) {
    showSystemMessage("This deployed contract's election has already permanently ended. Deploy a new contract to start a new election.", " One Election Per Contract");
    return;
  }

  if (!electionState.hasStarted) {
    showSystemMessage("You must start the election before stopping it.", " Not Started");
    return;
  }

  try {
    const message = `Admin Action: Stop Election Permanently\nContract: ${contractAddress}`;
    await signer.signMessage(message);

    electionState.hasStarted = false;
    electionState.hasEnded = true;
    saveStateToStorage();

    showSystemMessage("Election STOPPED permanently! This contract is now locked. Deploy a new contract to conduct another election.", " Election Permanently Closed");
    renderElectionUI();
  } catch (error) {
    console.error(error);
    showSystemMessage("MetaMask confirmation cancelled.", " Action Cancelled");
  }
}

// 6. Cast Vote
async function vote(candidateId) {
  if (electionState.hasEnded || !electionState.hasStarted) {
    showSystemMessage("Voting is only allowed while the election is open.", "Election Closed");
    return;
  }

  if (!isVoterLoggedIn) {
    showSystemMessage("Please log in using your registered Full Name in the Voter Login panel before voting.", "Login Required");
    return;
  }

  checkVoterStatus();

  if (!isVoterAuthorized) {
    showSystemMessage("You are not authorized by the Electoral Admin to vote yet.", "Not Authorized");
    return;
  }

  if (userVotes.includes(userAccount.toLowerCase())) {
    showSystemMessage("One Vote Only: You have already cast your ballot in this election.", "Warning");
    return;
  }

  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate) return;

  try {
    const ballotMessage = `Confirm Official Vote\nContract: ${contractAddress}\nCandidate: ${candidate.name} (${candidate.position})\nVoter Wallet: ${userAccount}`;
    await signer.signMessage(ballotMessage);

    candidate.voteCount += 1;
    userVotes.push(userAccount.toLowerCase());
    saveStateToStorage();

    showSystemMessage("Vote confirmed in MetaMask and recorded successfully!", "Vote Recorded");
    renderElectionUI();
  } catch (error) {
    console.error(error);
    showSystemMessage("MetaMask confirmation cancelled. Your vote was not submitted.", "Vote Cancelled");
  }
}

// Render UI directly from state (Zero page reloads or chain resets)
function renderElectionUI() {
  const isOpen = electionState.hasStarted && !electionState.hasEnded;
  const totalVoteCount = candidates.reduce((sum, c) => sum + c.voteCount, 0);
  totalVotes.innerText = "Total votes: " + totalVoteCount.toString();

  const registrationColumn = document.getElementById("registrationColumn");
  const candidatesColumn = document.getElementById("candidatesColumn");
  const candNameInput = document.getElementById("candidateName");
  const candPosInput = document.getElementById("candidatePosition");
  const addCandBtn = document.getElementById("addCandidateButton");
  const addCandNote = document.getElementById("addCandidateNote");
  const regBtn = document.getElementById("registerVoterBtn");
  const regFullNameInput = document.getElementById("regFullName");
  const regStatusNote = document.getElementById("regStatusNote");
  const authVoterBtn = document.getElementById("authorizeVoterButton");
  const startBtn = document.getElementById("startElectionButton");
  const endBtn = document.getElementById("endElectionButton");

  if (electionState.hasEnded) {
    if (registrationColumn) registrationColumn.classList.add("hidden");
    if (candidatesColumn) candidatesColumn.style.gridColumn = "span 2";
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.style.opacity = "0.5";
    }
    if (endBtn) {
      endBtn.disabled = true;
      endBtn.style.opacity = "0.5";
    }
  } else {
    if (registrationColumn) registrationColumn.classList.remove("hidden");
    if (candidatesColumn) candidatesColumn.style.gridColumn = "span 1";
    if (startBtn) {
      startBtn.disabled = isOpen;
      startBtn.style.opacity = isOpen ? "0.5" : "1";
    }
    if (endBtn) {
      endBtn.disabled = !isOpen;
      endBtn.style.opacity = !isOpen ? "0.5" : "1";
    }
  }

  if (isOpen || electionState.hasEnded) {
    if (candNameInput) candNameInput.disabled = true;
    if (candPosInput) candPosInput.disabled = true;
    if (addCandNote) addCandNote.innerText = "Adding candidates is permanently locked.";

    if (addCandBtn) {
      addCandBtn.disabled = true;
      addCandBtn.style.opacity = "0.5";
    }
    if (authVoterBtn) {
      authVoterBtn.disabled = true;
      authVoterBtn.style.opacity = "0.5";
    }
  } else {
    if (candNameInput) candNameInput.disabled = false;
    if (candPosInput) candPosInput.disabled = false;
    if (addCandNote) addCandNote.innerText = "Allowed only before the election starts.";

    if (addCandBtn) {
      addCandBtn.disabled = false;
      addCandBtn.style.opacity = "1";
    }
    if (authVoterBtn) {
      authVoterBtn.disabled = false;
      authVoterBtn.style.opacity = "1";
    }
  }

  if (isOpen) {
    if (regBtn) {
      regBtn.disabled = true;
      regBtn.style.opacity = "0.5";
    }
    if (regFullNameInput) regFullNameInput.disabled = true;
    if (regStatusNote) regStatusNote.innerText = "The Election is Open, Registration is Closed.";
  } else if (electionState.hasEnded) {
    if (regBtn) {
      regBtn.disabled = true;
      regBtn.style.opacity = "0.5";
    }
    if (regFullNameInput) regFullNameInput.disabled = true;
    if (regStatusNote) regStatusNote.innerText = "Contract Locked: Election ended. Deploy a new contract for another election.";
  } else {
    if (regBtn) {
      regBtn.disabled = false;
      regBtn.style.opacity = "1";
    }
    if (regFullNameInput) regFullNameInput.disabled = false;
    if (regStatusNote) {
      regStatusNote.innerText = "Enter your Full Name and connect your unique MetaMask wallet address. (1 address = 1 voter).";
    }
  }

  if (isOpen) {
    electionStatus.innerText = "Election is OPEN";
    electionStatus.className = "badge open";
  } else if (electionState.hasEnded) {
    electionStatus.innerText = "Election CLOSED (Deploy New Contract for Next Election)";
    electionStatus.className = "badge closed";
  } else {
    electionStatus.innerText = "Election NOT STARTED";
    electionStatus.className = "badge closed";
  }

  candidateList.innerHTML = "";

  if (candidates.length === 0) {
    candidateList.innerHTML = `<p class="helper-text">No candidates added yet.</p>`;
    return;
  }

  let maxVotes = -1;
  if (electionState.hasEnded && totalVoteCount > 0) {
    candidates.forEach((c) => {
      if (c.voteCount > maxVotes) maxVotes = c.voteCount;
    });
  }

  candidates.forEach((candidate) => {
    const div = document.createElement("div");

    if (electionState.hasEnded) {
      const percent = totalVoteCount > 0 ? ((candidate.voteCount / totalVoteCount) * 100).toFixed(1) : "0.0";
      const isWinner = totalVoteCount > 0 && candidate.voteCount === maxVotes;

      div.className = "result-bar-container";
      div.innerHTML = `
        <div class="result-row-top">
          <span>${candidate.name} (${candidate.position}) ${isWinner ? '<span class="winner-badge">WINNER</span>' : ''}</span>
          <span>${candidate.voteCount} vote(s) — ${percent}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${percent}%;"></div>
        </div>
      `;
    } else {
      div.className = "card";
      div.style.marginBottom = "10px";
      div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${candidate.name}</strong><br />
            <small style="color: #64748b;">Position: ${candidate.position}</small>
          </div>
          <span class="badge" style="background-color: var(--navy-blue); color: var(--gold);">
            Votes: ${candidate.voteCount}
          </span>
        </div>
      `;

      // Show Vote button when election is open and voter is logged in and authorized
      if (isOpen && isVoterLoggedIn && isVoterAuthorized) {
        const voteButton = document.createElement("button");
        voteButton.innerText = "Vote";
        voteButton.addEventListener("click", () => vote(candidate.id));
        div.appendChild(voteButton);
      }
    }

    candidateList.appendChild(div);
  });
}

// Initial UI Render
renderElectionUI();
