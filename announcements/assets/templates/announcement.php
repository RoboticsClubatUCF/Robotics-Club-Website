<?php
  // This class can generate an announcement block for the announcement page
  // Created Nov 4 by Alexandra French
  // Last updated Nov 4 by Alexandra French

  class Announcement {
    private $number;

    // Uses a counter to keep track of each announcement for color swapping
    public function __construct() {
      $this->number = 1;
    }
    
    // Takes in title, image, image alt text, description, date, and poster name. Optional: buttonText text, buttonText link
    // Will generate an announcement of such, with even being black and odd being white
    public function generate($title, $image, $imageAlt, $description, $date, $poster, $buttonText, $buttonTextLink) {
      echo "    <!-- Event Post " . $this->number . " -->      ";
      echo "<div class=\"mb-4 ";
      
      // based on number of announcements, set color
      if ($this->number%2 == 1) {
        echo "card-blk-gold";
      } else {
        echo "card-wht-blk";
      }
      
      echo "\">
        <div class=\"card-body\">
          <div class=\"row\">
            <!-- image -->\n            ";
      echo "<div class=\"col-lg-6\"><img class=\"img-fluid rounded\" src=\"" . $image . "\" alt=\"" . $imageAlt . "\"></div>\n            ";
      echo "<!-- event body -->
            <div class=\"col-lg-6\">
              <!-- title -->\n              ";
      echo "<h2 class=\"card-title\">" . $title . "</h2>\n              ";
      echo "<br>
              <!-- text -->\n              ";
      echo "<p class=\"card-text\">" . $description . "<br>" . "</p>\n              ";
      
      // if button text exists, create a button with coloring dependent on if odd or event numbered announcement
      if ($buttonText != null) {
        echo "<a href=\"" . $buttonTextLink . "\" class=\"btn pull-right ";
        if ($this->number%2 == 0) {
          echo "btn-dark";
        } else {
          echo "btn-light";
        }
        echo " \">" . $buttonText . "</a>\n            ";
      }
      
      echo "</div>
            <!-- /.event body -->
          </div>
        </div>
        <!-- date -->\n        ";
      echo "<div class=\"card-footer\">Posted on " . $date . " by " . $poster . "</div>\n      ";
      echo "</div>\n      ";
      echo "<!-- /.post " . $this->number . " -->\n\n";
      
      // increment counter for number of announcements
      $this->number += 1;
    }
  }

?>
