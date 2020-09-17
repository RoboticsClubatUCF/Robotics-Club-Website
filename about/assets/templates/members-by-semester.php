    <!-- tabs for each year -->
    <ul class="mini-tabs nav nav-tabs rounded-top">
        <?php
          // for each year, create a new tab. if year is first one, make active
          $years = array_keys($memberYears);
          foreach ($years as $year) {
            if ($year == $years[0]) {
              echo "<li class=\"nav-item rounded-top\"><a class=\"nav-link active\" data-toggle=\"tab\" href=\"#yr" . $year . "\">" . $year . "</a></li>";
            } else {
              echo "\n\t\t<li class=\"nav-item rounded-top\"><a class=\"nav-link\" data-toggle=\"tab\" href=\"#yr" . $year . "\">" . $year . "</a></li>";
            }
          }
        ?>

    </ul>
    <!-- /.tabs for each year -->

    <!-- tab content for each year -->
    <div class="tab-content">
    <?php
    // for each year, create tab content
    foreach ($memberYears as $year => $semester): ?>
      <!-- <?php echo $year ?> -->
      <?php
        // add each year as a tab container. if year is first one, make active
        if ($year == $years[0]) {
          echo "<div class=\"tab-pane container active\" id=\"yr" . $year . "\">";
        } else {
          echo "<div class=\"tab-pane container\" id=\"yr" . $year . "\">";
        }
      ?>
        <!-- tabs for each semester  -->
        <ul class="nav nav-tabs gry-tabs rounded-top">
          <?php
            $numSem = 0;
            // add each semester as a tab. If semester is first one, make active
            while ($numSem < count($semester)) {
              if ($semester[$numSem] == $semester[0]) {
                echo "<li class=\"nav-item rounded-top\"><a class=\"nav-link active\" data-toggle=\"tab\" href=\"#" .  "sem" . $semester[$numSem][0] . $semester[$numSem][1] . $year . "\">" . $semester[$numSem] . "</a></li>";
              } else {
                echo "\n\t\t  <li class=\"nav-item rounded-top\"><a class=\"nav-link\" data-toggle=\"tab\" href=\"#" .  "sem" . $semester[$numSem][0] . $semester[$numSem][1] . $year . "\">" . $semester[$numSem] . "</a></li>";
              }
              $numSem += 1;
            }
          ?>

        </ul>
        <div class="tab-content">
          <?php
            $numSem = 0;
            // add each semester's content/container. If first one, make active
            while ($numSem < count($semester)) {
              echo "\n\t\t\t<!-- " . $semester[$numSem] . " -->";
              if ($numSem == 0) {
                  echo "\n\t\t\t<div class=\"tab-pane container active\" id=\"" . "sem" . $semester[$numSem][0] . $semester[$numSem][1] . $year . "\">\n\t\t\t";
              } else {
                  echo "\n\t\t\t<div class=\"tab-pane container\" id=\"" . "sem" . $semester[$numSem][0] . $semester[$numSem][1] . $year . "\">\n\t\t\t";
              }

              // make use of member template to fill members using a member CSV file
              $membersTitle = $semester[$numSem] . " " . $year . " Members";
              $membersTitleColor = "white";
              $csvFile = "assets/misc/membersList" . "-" . $semester[$numSem][0] . $semester[$numSem][1] . $year . ".csv";
              include('assets/templates/members-list.php');

              echo "\n\t\t\t</div>";
              echo "\n\t\t\t<!-- /." . $semester[$numSem] . " -->";
              $numSem += 1;
            }
            ?>

        </div>
        <!-- /.tabs for each semester -->
      </div>
      <!-- /.<?php echo $year ?> -->
    <?php endforeach; ?>

    </div>
    <!-- /.tab content for each year -->
