var alert=document.getElementById("alert-modal");var alertButton=document.getElementById("alert-btn");alertButton.onclick=function(){alert.style.display="block";}
var close=document.getElementsByClassName("close")[0];close.onclick=function(){alert.style.display="none";}
window.onclick=function(event){if(event.target==alert){alert.style.display="none";}}