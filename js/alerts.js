/* Dark mode for the webpage
Created by: Alexandra French
For: the Robotics Club of Central Florida
On: August 10, 2020

Last modified on: August 10, 2020
By: Alexandra French
*/

// grab the alert popup
var alert = document.getElementById("alert-modal");

// grab the button, and if click on button show the alert
var alertButton = document.getElementById("alert-btn");
alertButton.onclick = function() {
  alert.style.display = "block";
}

// grab the alert close button, and if click on it close
var close = document.getElementsByClassName("close")[0];
close.onclick = function() {
  alert.style.display = "none";
}

// If click outside alert, close the alert popup
window.onclick = function(event) {
  if (event.target == alert) {
    alert.style.display = "none";
  }
}
