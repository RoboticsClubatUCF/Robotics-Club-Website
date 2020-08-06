/* grid script to show and hide all linkable and clickable items in the grid
Created by: Alexandra French
For: the Robotics Club of Central Florida
On: August 5, 2020
*/

// if clicked in a particular grid section of join, follow, contact, and Visit
// then show all links. otherwise, dont show anything to avoid accidental clicks
// if clicked in follow, show links, otherwise hide them
function adjustLinks(seconds) {
  // avoid accidental clicks for join
  if (document.getElementById('join-overlay').contains(event.target)) {
    // shows link on a delay timer to avoid clicking them
    setTimeout(function(){
      var links = document.getElementsByClassName("grid1-link");
      for (var i = 0; i < links.length; i++) {
        links[i].style.pointerEvents = "auto";
      }
    }, seconds);
  } else {
    // hides links immediately to avoid clicking them
    var links = document.getElementsByClassName("grid1-link");
    for (var i = 0; i < links.length; i++) {
      links[i].style.pointerEvents = "none";
    }
  }

  // avoid accidental clicks for follow
  if (document.getElementById('follow-overlay').contains(event.target)) {
    // shows link on a delay timer to avoid clicking them
    setTimeout(function(){
      var links = document.getElementsByClassName("grid2-link");
      for (var i = 0; i < links.length; i++) {
        links[i].style.pointerEvents = "auto";
      }
    }, seconds);
  } else {
    // hides links immediately to avoid clicking them
    var links = document.getElementsByClassName("grid2-link");
    for (var i = 0; i < links.length; i++) {
      links[i].style.pointerEvents = "none";
    }
  }

  // avoid accidental clicks for contact
  if (document.getElementById('contact-overlay').contains(event.target)) {
    // shows link on a delay timer to avoid clicking them
    setTimeout(function(){
      var links = document.getElementsByClassName("grid3-link");
      for (var i = 0; i < links.length; i++) {
        links[i].style.pointerEvents = "auto";
      }
    }, seconds);
  } else {
    // hides links immediately to avoid clicking them
    var links = document.getElementsByClassName("grid3-link");
    for (var i = 0; i < links.length; i++) {
      links[i].style.pointerEvents = "none";
    }
  }
}

// track clicks for mobile
document.addEventListener('click', function() {
  // calls a function that disables links for inactive grid cards
  adjustLinks(2500);
});

// track mouseover for computer
document.addEventListener('mouseover', function() {
  // calls a function that disables links for inactive grid cards
  adjustLinks(500);
});
